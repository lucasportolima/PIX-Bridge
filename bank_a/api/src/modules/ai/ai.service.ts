import { Injectable, Logger } from '@nestjs/common';
import { TypedConfigService } from '../../config';

export interface ParsedTransferCommand {
  receiverPixKey: string;
  /** Amount in cents */
  amount: number;
  description?: string;
  confidence: number;
}

/**
 * Interprets free-text transfer commands using OpenAI Function Calling.
 *
 * The LLM never executes the transfer — it only extracts structured parameters
 * from the user's natural language input. The actual transfer is initiated
 * via TransferService after explicit user confirmation.
 *
 * Example input: "Manda 50 reais pro joao@pix.com pra pagar o almoço"
 * Example output: { receiverPixKey: "joao@pix.com", amount: 5000, description: "almoço", confidence: 0.97 }
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly config: TypedConfigService) {}

  async parseTransferCommand(input: string): Promise<ParsedTransferCommand> {
    const apiKey = this.config.get('OPENAI_API_KEY');
    const model = this.config.get('OPENAI_MODEL');

    const body = {
      model,
      messages: [
        {
          role: 'system',
          content: `Você é um assistente financeiro. Extraia os dados de uma transferência PIX a partir do texto do usuário.
Sempre responda usando a função extract_transfer_data. Se não conseguir identificar todos os campos, retorne confidence < 0.5.`,
        },
        { role: 'user', content: input },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'extract_transfer_data',
            description: 'Extrai os dados de uma transferência PIX do texto',
            parameters: {
              type: 'object',
              properties: {
                receiverPixKey: {
                  type: 'string',
                  description: 'Chave PIX do destinatário (CPF, e-mail, telefone ou chave aleatória)',
                },
                amount: {
                  type: 'number',
                  description: 'Valor em centavos (inteiro). Ex: R$50 = 5000',
                },
                description: {
                  type: 'string',
                  description: 'Descrição opcional da transferência',
                },
                confidence: {
                  type: 'number',
                  description: 'Confiança da extração entre 0 e 1',
                },
              },
              required: ['receiverPixKey', 'amount', 'confidence'],
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'extract_transfer_data' } },
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          tool_calls?: Array<{ function: { arguments: string } }>;
        };
      }>;
    };

    const toolCall = data.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error('No tool call returned by LLM');

    const parsed = JSON.parse(toolCall.function.arguments) as ParsedTransferCommand;
    this.logger.debug({ input, parsed }, 'Transfer command parsed by LLM');

    return parsed;
  }
}
