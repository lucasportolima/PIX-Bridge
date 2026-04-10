import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { OutboxEvent, OutboxEventDocument, OutboxStatus } from './schemas/outbox-event.schema';

/**
 * Número máximo de tentativas de publicação antes de mover o evento para DEAD.
 * Com retry a cada 500ms e backoff exponencial implícito pelo ciclo, 5 falhas
 * consecutivas indicam problema estrutural (Kafka down, payload inválido, etc.)
 */
const MAX_RETRY_COUNT = 5;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectModel(OutboxEvent.name)
    private readonly outboxModel: Model<OutboxEventDocument>,
  ) {}

  /**
   * Persiste um OutboxEvent DENTRO de uma sessão de transação existente.
   *
   * Chamado exclusivamente pelo TransferService, dentro da mesma sessão
   * que debita o saldo. Isso garante que débito e evento são atômicos:
   * ambos commitam juntos ou nenhum commita.
   *
   * @param params - dados do evento CloudEvents
   * @param session - sessão MongoDB ativa da transação do TransferService
   */
  async createEvent(
    params: {
      topic: string;
      eventType: string;
      aggregateId: string;
      payload: Record<string, unknown>;
    },
    session: ClientSession,
  ): Promise<OutboxEventDocument> {
    const [event] = await this.outboxModel.create([params], { session });
    this.logger.debug({ aggregateId: params.aggregateId, topic: params.topic }, 'Outbox event created');
    return event;
  }

  /**
   * Reivindica atomicamente um lote de eventos PENDING para processamento.
   *
   * ESTRATÉGIA DE CLAIM (dois passos):
   * ──────────────────────────────────────────────────────────────────────
   * Não existe uma operação "find-and-update-many" atômica no MongoDB.
   * A abordagem usada aqui — find IDs → updateMany — tem uma pequena janela
   * de race condition em deployments multi-instância: entre o `find` e o
   * `updateMany`, outra instância pode reivindicar os mesmos IDs.
   *
   * Para este POC (instância única), isso é aceitável.
   * Em produção multi-instância, usaríamos um loop de `findOneAndUpdate`
   * ou um distributed lock (Redis SETNX) para garantir exclusividade.
   *
   * O campo `processingStartedAt` permite que `requeueStuck` recupere
   * eventos que ficaram em PROCESSING por mais de 30s (worker travado/crashado).
   *
   * @param limit - número máximo de eventos a reivindicar por ciclo
   * @returns array de eventos com status PROCESSING (prontos para publicar)
   */
  async claimBatch(limit: number): Promise<OutboxEventDocument[]> {
    const candidates = await this.outboxModel
      .find({ status: OutboxStatus.PENDING })
      .sort({ createdAt: 1 }) // FIFO — processa na ordem de criação
      .limit(limit)
      .select('_id')
      .lean()
      .exec();

    if (candidates.length === 0) return [];

    const ids = candidates.map((e) => e._id);
    const claimedAt = new Date();

    // Atomic claim — apenas atualiza documentos que ainda estão PENDING
    // (evita reivindicar eventos que outra instância já capturou)
    await this.outboxModel.updateMany(
      { _id: { $in: ids }, status: OutboxStatus.PENDING },
      { $set: { status: OutboxStatus.PROCESSING, processingStartedAt: claimedAt } },
    );

    // Retorna apenas os eventos que de fato foram reivindicados
    return this.outboxModel.find({ _id: { $in: ids }, status: OutboxStatus.PROCESSING }).exec();
  }

  /**
   * Marca um evento como publicado com sucesso.
   */
  async markPublished(id: string): Promise<void> {
    await this.outboxModel.updateOne(
      { _id: id },
      { $set: { status: OutboxStatus.PUBLISHED, publishedAt: new Date() } },
    );
  }

  /**
   * Registra uma falha de publicação e decide o próximo estado.
   *
   * USA AGGREGATION PIPELINE UPDATE (MongoDB 4.2+) para ler e atualizar
   * `retryCount` em uma única operação atômica, sem race condition:
   *
   *   $set.status = IF (retryCount + 1 >= MAX_RETRIES) THEN 'dead' ELSE 'pending'
   *   $set.retryCount = retryCount + 1
   *
   * Isso é equivalente ao `UPDATE ... SET ... WHERE ... RETURNING ...` do SQL,
   * mas feito como uma expressão dentro do próprio update do MongoDB.
   *
   * @param id - `_id` do OutboxEvent
   * @param error - mensagem de erro da tentativa falha
   */
  async markFailed(id: string, error: string): Promise<void> {
    await this.outboxModel.findOneAndUpdate(
      { _id: id },
      [
        {
          $set: {
            retryCount: { $add: ['$retryCount', 1] },
            lastError: error,
            processingStartedAt: '$$REMOVE',
            // Decisão inline: DEAD se esgotou retries, senão volta para PENDING
            status: {
              $cond: {
                if: { $gte: [{ $add: ['$retryCount', 1] }, MAX_RETRY_COUNT] },
                then: OutboxStatus.DEAD,
                else: OutboxStatus.PENDING,
              },
            },
          },
        },
      ],
      { new: true },
    );
  }

  /**
   * Recoloca em PENDING eventos que ficaram presos em PROCESSING.
   *
   * Cenário coberto: o worker fez o claim (PROCESSING) mas o processo morreu
   * antes de publicar. Sem esse mecanismo, o evento ficaria preso em
   * PROCESSING para sempre.
   *
   * Chamado pelo worker a cada ~30s (60 ciclos × 500ms).
   *
   * @param stuckAfterMs - threshold em ms para considerar um evento como preso
   * @returns número de eventos recolocados na fila
   */
  async requeueStuck(stuckAfterMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - stuckAfterMs);
    const result = await this.outboxModel.updateMany(
      {
        status: OutboxStatus.PROCESSING,
        processingStartedAt: { $lt: cutoff },
      },
      {
        $set: { status: OutboxStatus.PENDING },
        $unset: { processingStartedAt: '' },
      },
    );
    return result.modifiedCount;
  }

  /**
   * Retorna estatísticas de saúde da fila — útil para métricas/alertas.
   */
  async getStats(): Promise<Record<OutboxStatus, number>> {
    const counts = await this.outboxModel.aggregate<{ _id: OutboxStatus; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const stats = Object.values(OutboxStatus).reduce(
      (acc, status) => ({ ...acc, [status]: 0 }),
      {} as Record<OutboxStatus, number>,
    );

    for (const { _id, count } of counts) {
      stats[_id] = count;
    }

    return stats;
  }
}
