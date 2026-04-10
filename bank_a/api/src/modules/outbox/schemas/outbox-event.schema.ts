import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OutboxEventDocument = HydratedDocument<OutboxEvent>;

export enum OutboxStatus {
  /** Evento persistido, aguardando o worker fazer o claim */
  PENDING = 'pending',
  /**
   * Evento foi reivindicado pelo OutboxWorker e está sendo publicado.
   * Se o processo morrer com status PROCESSING, o `requeueStuck` vai
   * recolocar o evento em PENDING após o timeout de 30s.
   */
  PROCESSING = 'processing',
  /** Publicado com sucesso no Kafka */
  PUBLISHED = 'published',
  /**
   * Publicação falhou, mas ainda abaixo do limite de retries.
   * O worker vai reivindicar novamente no próximo ciclo.
   * Nota: o worker redefine para PENDING após a falha — esse valor
   * não é armazenado diretamente; usamos PENDING + retryCount > 0.
   */
  FAILED = 'failed',
  /**
   * Limite de retries esgotado — evento no dead letter.
   * Requer intervenção manual ou processo de reconciliação.
   */
  DEAD = 'dead',
}

/**
 * Transactional Outbox Pattern — garante entrega at-least-once ao Kafka.
 *
 * FLUXO COMPLETO:
 * ────────────────────────────────────────────────────────────────────────
 *
 *   TransferService         OutboxWorkerService       Kafka
 *        │                        │                     │
 *        │── startSession ───────>│                     │
 *        │── debitBalance ───────>│                     │
 *        │── create Transfer ────>│                     │
 *        │── createEvent(PENDING)─────────────────>│    │
 *        │── commitTransaction ──>│                     │
 *        │                        │                     │
 *        │             [500ms later]                    │
 *        │                        │── claimBatch ──>│   │
 *        │                        │   PENDING→PROCESSING│
 *        │                        │── publish ──────────>│
 *        │                        │── markPublished ──>│ │
 *
 * SE O APP CRASHAR com status PROCESSING:
 *   - requeueStuck() detecta evento > 30s em PROCESSING
 *   - Reseta para PENDING → worker retenta na próxima rodada
 *
 * DUAL-WRITE PREVENTION:
 *   O OutboxEvent é salvo na mesma transação MongoDB do débito.
 *   Se o app crashar ANTES do commit → débito NÃO ocorre, evento NÃO existe.
 *   Se o app crashar APÓS o commit → débito ocorreu, evento existe (PENDING).
 *   O worker vai publicar na próxima rodada. Nunca existe débito sem evento.
 */
@Schema({ timestamps: true, collection: 'outbox_events' })
export class OutboxEvent {
  /** Tópico Kafka de destino — ex: `pix.transfer.initiated` */
  @Prop({ required: true })
  topic: string;

  /** Campo `type` do CloudEvents — ex: `pix.transfer.initiated` */
  @Prop({ required: true })
  eventType: string;

  /**
   * Chave de idempotência — igual ao `transferId` da transferência originadora.
   * Único no banco: previne que a mesma transferência gere dois eventos distintos.
   */
  @Prop({ required: true, unique: true })
  aggregateId: string;

  /** Payload CloudEvents 1.0 serializado */
  @Prop({ required: true, type: Object })
  payload: Record<string, unknown>;

  @Prop({ enum: OutboxStatus, default: OutboxStatus.PENDING })
  status: OutboxStatus;

  /** Número de tentativas de publicação que falharam */
  @Prop({ default: 0 })
  retryCount: number;

  /** Mensagem de erro da última tentativa falha */
  @Prop()
  lastError?: string;

  /**
   * Timestamp em que o worker fez o claim (status → PROCESSING).
   * Usado pelo `requeueStuck` para detectar eventos presos.
   */
  @Prop()
  processingStartedAt?: Date;

  /** Timestamp da publicação bem-sucedida */
  @Prop()
  publishedAt?: Date;
}

export const OutboxEventSchema = SchemaFactory.createForClass(OutboxEvent);

// Índice principal do worker de polling — status + ordem de criação (FIFO)
OutboxEventSchema.index({ status: 1, createdAt: 1 });
// Requeue de stuck — filtra PROCESSING + processingStartedAt
OutboxEventSchema.index({ status: 1, processingStartedAt: 1 });
