import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Transfer, TransferDocument, TransferDirection, TransferStatus } from './schemas/transfer.schema';
import { AccountService } from '../account/account.service';
import { OutboxService } from '../outbox/outbox.service';

export interface InitiateTransferParams {
  /** Número de conta do remetente autenticado */
  senderAccountNumber: string;
  /** Chave PIX do remetente (para exibição no extrato) */
  senderPixKey: string;
  /** Chave PIX do destinatário (Bank B irá resolver para uma conta) */
  receiverPixKey: string;
  /** Valor em centavos — mínimo 1 */
  amountCents: number;
  description?: string;
  /** W3C traceparent trace-id, propagado do header HTTP */
  correlationId?: string;
}

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    @InjectModel(Transfer.name)
    private readonly transferModel: Model<TransferDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly accountService: AccountService,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Inicia uma transferência PIX de saída: Bank A → Bank B.
   *
   * TRANSAÇÃO MONGODB (multi-documento):
   * ─────────────────────────────────────────────────────────────────
   * As três operações abaixo são atomicamente agrupadas em uma única
   * transação ACID no MongoDB (disponível em replica sets a partir da v4.0):
   *
   *   1. DÉBITO ATÔMICO — `AccountService.debitBalance()`
   *      Usa `findOneAndUpdate` com filtro `balance: { $gte: amount }`.
   *      Se o saldo for insuficiente, a query não encontra o documento
   *      e lança BadRequestException. Isso previne o "lost update problem":
   *      dois processos debitando o mesmo saldo não resultam em saldo negativo.
   *
   *   2. TRANSFER DOCUMENT — cria o registro da transferência com status PENDING.
   *
   *   3. OUTBOX EVENT — persiste o evento CloudEvents que será publicado no Kafka.
   *
   * SE QUALQUER PASSO FALHAR → rollback automático de TODOS os passos.
   * Não há estado parcial. O saldo debitado é restaurado se o Transfer ou
   * o OutboxEvent não puderem ser criados.
   *
   * DUAL-WRITE PREVENTION (Transactional Outbox Pattern):
   * ─────────────────────────────────────────────────────────────────
   * Problema clássico: salvar no banco E publicar no Kafka são duas
   * operações separadas. Se o app cair entre elas:
   *   - Saldo debitado mas evento Kafka nunca publicado → dinheiro sumiu
   *   - Evento publicado mas saldo não debitado → transferência sem débito
   *
   * Solução: o evento Kafka é persistido no MongoDB (na mesma transação)
   * como um OutboxEvent com `status: pending`. Um worker separado (OutboxPublisher,
   * TASK-07) lê esses eventos e os publica no Kafka, marcando como `published`.
   * Se o app cair, o worker retoma os eventos pendentes no próximo restart.
   */
  async initiateOutbound(params: InitiateTransferParams): Promise<TransferDocument> {
    if (params.amountCents < 1) {
      throw new BadRequestException('O valor mínimo de transferência é R$0,01');
    }

    const transferId = uuidv4();
    const session = await this.connection.startSession();

    try {
      let transfer!: TransferDocument;

      await session.withTransaction(async () => {
        // ── 1. DÉBITO ATÔMICO ──────────────────────────────────────
        // `debitBalance` usa findOneAndUpdate com filtro de saldo suficiente.
        // Se o saldo for insuficiente ou a conta inativa, lança exceção
        // e a transação inteira é revertida automaticamente.
        await this.accountService.debitBalance(
          params.senderAccountNumber,
          params.amountCents,
          session,
        );

        // ── 2. TRANSFER DOCUMENT ───────────────────────────────────
        // `create([...], { session })` — notação de array é obrigatória
        // quando se usa session no Mongoose, pois retorna um array.
        [transfer] = await this.transferModel.create(
          [
            {
              transferId,
              senderAccountNumber: params.senderAccountNumber,
              senderPixKey: params.senderPixKey,
              receiverPixKey: params.receiverPixKey,
              amount: params.amountCents,
              description: params.description,
              status: TransferStatus.PENDING,
              direction: TransferDirection.OUTBOUND,
              correlationId: params.correlationId,
            },
          ],
          { session },
        );

        // ── 3. OUTBOX EVENT (CloudEvents 1.0) ─────────────────────
        // Payload segue a spec CloudEvents para interoperabilidade com Bank B.
        // O campo `data` contém o payload de domínio; os campos raiz são
        // metadados de envelopagem (specversion, type, source, id, time).
        await this.outboxService.createEvent(
          {
            topic: 'pix.transfer.initiated',
            eventType: 'pix.transfer.initiated',
            aggregateId: transferId,
            payload: {
              specversion: '1.0',
              type: 'pix.transfer.initiated',
              source: '/bank-a/transfer',
              id: transferId,
              time: new Date().toISOString(),
              datacontenttype: 'application/json',
              data: {
                transferId,
                senderAccountNumber: params.senderAccountNumber,
                senderPixKey: params.senderPixKey,
                receiverPixKey: params.receiverPixKey,
                amountCents: params.amountCents,
                description: params.description ?? null,
                correlationId: params.correlationId ?? null,
              },
            },
          },
          session,
        );

        this.logger.log(
          {
            transferId,
            senderAccountNumber: params.senderAccountNumber,
            amountCents: params.amountCents,
            correlationId: params.correlationId,
          },
          'Transfer initiated — outbox event persisted',
        );
      });

      return transfer;
    } finally {
      // Sempre encerra a sessão, independente de sucesso ou falha.
      // Não encerrar sessões vaza conexões do pool do MongoDB.
      await session.endSession();
    }
  }

  async findByTransferId(transferId: string): Promise<TransferDocument> {
    const transfer = await this.transferModel.findOne({ transferId }).exec();
    if (!transfer) throw new NotFoundException(`Transfer ${transferId} not found`);
    return transfer;
  }

  /**
   * Retorna o extrato de transferências de uma conta com paginação.
   * Inclui transferências de entrada (recebidas) e saída (enviadas).
   */
  async findByAccount(
    accountNumber: string,
    limit = 20,
    offset = 0,
  ): Promise<{ items: TransferDocument[]; total: number }> {
    const filter = {
      $or: [
        { senderAccountNumber: accountNumber },
        // Inclui transferências recebidas (inbound) quando implementado
        { direction: TransferDirection.INBOUND, receiverAccountNumber: accountNumber },
      ],
    };

    const [items, total] = await Promise.all([
      this.transferModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .exec(),
      this.transferModel.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }

  /**
   * Atualiza o status de uma transferência.
   * Chamado pelo consumer Kafka quando Bank B confirma ou rejeita.
   */
  async updateStatus(
    transferId: string,
    status: TransferStatus,
    failureReason?: string,
  ): Promise<void> {
    const update: Record<string, unknown> = { status };
    if (status === TransferStatus.COMPLETED) update.completedAt = new Date();
    if (failureReason) update.failureReason = failureReason;

    const result = await this.transferModel.updateOne({ transferId }, { $set: update });
    if (result.matchedCount === 0) {
      throw new NotFoundException(`Transfer ${transferId} not found`);
    }
  }
}
