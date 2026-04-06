import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TransferDocument = HydratedDocument<Transfer>;

export enum TransferStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REVERSED = 'reversed',
}

export enum TransferDirection {
  /** Bank A → Bank B */
  OUTBOUND = 'outbound',
  /** Bank B → Bank A (incoming credit) */
  INBOUND = 'inbound',
}

/**
 * Represents a PIX transfer initiated or received by Bank A.
 *
 * `correlationId` is the W3C traceparent trace-id used to correlate the
 * full lifecycle of the transfer across both banks and Kafka events.
 */
@Schema({ timestamps: true, collection: 'transfers' })
export class Transfer {
  @Prop({ required: true, unique: true })
  transferId: string;

  @Prop({ required: true })
  senderAccountNumber: string;

  @Prop({ required: true })
  receiverPixKey: string;

  /** Amount in cents */
  @Prop({ required: true, min: 1 })
  amount: number;

  @Prop({ trim: true, maxlength: 140 })
  description?: string;

  @Prop({ enum: TransferStatus, default: TransferStatus.PENDING })
  status: TransferStatus;

  @Prop({ enum: TransferDirection, required: true })
  direction: TransferDirection;

  /** W3C traceparent trace-id for distributed tracing */
  @Prop()
  correlationId?: string;

  /** Error message when status = failed */
  @Prop()
  failureReason?: string;

  @Prop()
  completedAt?: Date;
}

export const TransferSchema = SchemaFactory.createForClass(Transfer);

TransferSchema.index({ senderAccountNumber: 1, createdAt: -1 });
TransferSchema.index({ status: 1 });
TransferSchema.index({ correlationId: 1 });
