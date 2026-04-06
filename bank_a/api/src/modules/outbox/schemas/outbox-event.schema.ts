import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OutboxEventDocument = HydratedDocument<OutboxEvent>;

export enum OutboxStatus {
  PENDING = 'pending',
  PUBLISHED = 'published',
  FAILED = 'failed',
}

/**
 * Transactional Outbox pattern — guarantees at-least-once delivery to Kafka.
 *
 * Flow:
 *  1. Transfer domain saves OutboxEvent in the same MongoDB transaction as the balance debit.
 *  2. OutboxPublisher (separate worker) polls `status: pending` events and publishes to Kafka.
 *  3. On successful publish, status is set to `published`.
 *
 * This prevents the dual-write problem: if the app crashes after the DB write
 * but before the Kafka publish, the event will be retried on next poll.
 */
@Schema({ timestamps: true, collection: 'outbox_events' })
export class OutboxEvent {
  /** Kafka topic where the event must be published */
  @Prop({ required: true })
  topic: string;

  /** CloudEvents type field, e.g. `pix.transfer.initiated` */
  @Prop({ required: true })
  eventType: string;

  /** Idempotency key — correlates to the originating transferId */
  @Prop({ required: true, unique: true })
  aggregateId: string;

  /** Serialised CloudEvents payload */
  @Prop({ required: true, type: Object })
  payload: Record<string, unknown>;

  @Prop({ enum: OutboxStatus, default: OutboxStatus.PENDING })
  status: OutboxStatus;

  /** Number of failed publish attempts for this event */
  @Prop({ default: 0 })
  retryCount: number;

  /** Error message from the last failed attempt */
  @Prop()
  lastError?: string;

  /** Timestamp of the last successful publish */
  @Prop()
  publishedAt?: Date;
}

export const OutboxEventSchema = SchemaFactory.createForClass(OutboxEvent);

// Polling query: `{ status: 'pending' }` — partial index for efficiency
OutboxEventSchema.index({ status: 1, createdAt: 1 });
