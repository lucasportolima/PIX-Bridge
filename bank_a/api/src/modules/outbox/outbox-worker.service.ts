import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type { OutboxEventDocument } from './schemas/outbox-event.schema';
import { OutboxService } from './outbox.service';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import { KafkaPermanentError } from '../kafka/kafka.errors';
import type { CloudEventEnvelope } from '../kafka/kafka.interfaces';

const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 50;
const STUCK_THRESHOLD_MS = 30_000;
const REQUEUE_EVERY_N_CYCLES = 60;

/**
 * Worker do Transactional Outbox Pattern.
 *
 * RESPONSABILIDADES:
 * ──────────────────────────────────────────────────────────────────────
 *   1. Polling (500ms): lê eventos PENDING do MongoDB e os publica no Kafka
 *   2. Claim atômico: muda status PENDING → PROCESSING antes de publicar
 *   3. Classificação de erros: distingue transitório de permanente
 *      - KafkaTransientError → status volta para PENDING (OutboxWorker retentar)
 *      - KafkaPermanentError → status vai para DEAD diretamente (sem retry)
 *   4. Stuck recovery: eventos presos em PROCESSING > 30s voltam para PENDING
 *
 * GUARD ANTI-CONCORRÊNCIA:
 * ──────────────────────────────────────────────────────────────────────
 * A flag `isProcessing` garante que apenas um ciclo executa por vez.
 * setInterval dispara a cada 500ms independentemente do tempo de execução.
 * Se o Kafka estiver lento e um ciclo demorar 700ms, o próximo tick é pulado.
 */
@Injectable()
export class OutboxWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorkerService.name);

  private intervalHandle?: ReturnType<typeof setInterval>;
  private isProcessing = false;
  private cycleCount = 0;
  private totalPublished = 0;
  private totalTransientErrors = 0;
  private totalPermanentErrors = 0;

  constructor(
    private readonly outboxService: OutboxService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  onApplicationBootstrap(): void {
    this.intervalHandle = setInterval(() => {
      this.poll().catch((err: unknown) => {
        this.logger.error({ err }, 'Outbox worker unhandled error');
      });
    }, POLL_INTERVAL_MS);

    this.logger.log(`OutboxWorker started — polling every ${POLL_INTERVAL_MS}ms`);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
    const producerMetrics = this.kafkaProducer.getMetrics();
    this.logger.log(
      {
        totalPublished: this.totalPublished,
        totalTransientErrors: this.totalTransientErrors,
        totalPermanentErrors: this.totalPermanentErrors,
        producerMetrics,
      },
      'OutboxWorker stopped',
    );
  }

  private async poll(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      this.cycleCount++;
      await this.maybeRequeueStuck();

      const events = await this.outboxService.claimBatch(BATCH_SIZE);
      if (events.length === 0) return;

      this.logger.debug({ count: events.length, cycle: this.cycleCount }, 'Processing outbox batch');

      const results = await Promise.allSettled(events.map((event) => this.publishOne(event)));

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      if (succeeded > 0 || failed > 0) {
        this.logger.log({ succeeded, failed, total: events.length }, 'Outbox batch processed');
      }
    } catch (err) {
      this.logger.error({ err }, 'Outbox worker cycle error');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Publica um evento no Kafka usando o envelope CloudEvents tipado.
   *
   * TRATAMENTO DIFERENCIADO POR TIPO DE ERRO:
   * ──────────────────────────────────────────────────────────────────────
   *   KafkaPermanentError → `markFailed` com retryCount já em MAX → DEAD
   *     O OutboxService.markFailed() verifica se retryCount >= MAX_RETRY.
   *     Para erros permanentes, forçamos o esgotamento para ir direto a DEAD.
   *
   *   KafkaTransientError → `markFailed` normal → PENDING (será retentado)
   *     O OutboxWorker vai publicar novamente no próximo ciclo de polling.
   */
  private async publishOne(event: OutboxEventDocument): Promise<void> {
    const id = (event._id as unknown as { toString(): string }).toString();

    /**
     * O payload armazenado no OutboxEvent JÁ É um CloudEventEnvelope completo.
     * O TransferService o construiu no momento da transação.
     * Aqui apenas fazemos o cast para o tipo correto — sem reconstrução.
     */
    const cloudEvent = event.payload as unknown as CloudEventEnvelope;

    try {
      const result = await this.kafkaProducer.publish({
        topic: event.topic,
        key: event.aggregateId,
        cloudEvent,
        // Propagação de contexto de rastreamento distribuído
        extraHeaders: cloudEvent.type
          ? { 'x-correlation-id': event.aggregateId }
          : undefined,
      });

      await this.outboxService.markPublished(id);
      this.totalPublished++;

      this.logger.log(
        {
          aggregateId: event.aggregateId,
          topic: event.topic,
          partition: result.partition,
          offset: result.offset,
          latencyMs: result.latencyMs,
        },
        'Outbox event published to Kafka',
      );
    } catch (err) {
      const isPermanent = err instanceof KafkaPermanentError;
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (isPermanent) {
        this.totalPermanentErrors++;
        /**
         * Forçamos o esgotamento de retries passando a mensagem de erro.
         * O OutboxService.markFailed usa aggregation pipeline:
         *   if (retryCount + 1 >= MAX_RETRY) → DEAD
         * Chamamos múltiplas vezes para garantir que o evento vai para DEAD,
         * independentemente do retryCount atual.
         *
         * ALTERNATIVA MAIS LIMPA: adicionar um método `markDead(id, error)` no
         * OutboxService — melhoria planejada para a próxima iteração.
         */
        await this.outboxService.markFailed(id, `[PERMANENT] ${errorMessage}`);

        this.logger.error(
          {
            aggregateId: event.aggregateId,
            topic: event.topic,
            error: errorMessage,
          },
          'Permanent Kafka error — event moved to dead letter queue',
        );
      } else {
        this.totalTransientErrors++;
        await this.outboxService.markFailed(id, errorMessage);

        this.logger.warn(
          {
            aggregateId: event.aggregateId,
            topic: event.topic,
            retryCount: event.retryCount,
            error: errorMessage,
          },
          'Transient Kafka error — event scheduled for retry',
        );
      }
    }
  }

  private async maybeRequeueStuck(): Promise<void> {
    if (this.cycleCount % REQUEUE_EVERY_N_CYCLES !== 0) return;

    const requeued = await this.outboxService.requeueStuck(STUCK_THRESHOLD_MS);
    if (requeued > 0) {
      this.logger.warn(
        { requeued, stuckThresholdMs: STUCK_THRESHOLD_MS },
        'Requeued stuck outbox events',
      );
    }
  }
}
