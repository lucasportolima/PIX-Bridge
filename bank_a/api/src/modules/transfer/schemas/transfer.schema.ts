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
 * Documento de transferência PIX do Banco A.
 *
 * CICLO DE VIDA DE STATUS:
 * ─────────────────────────────────────────────────────────────────
 *
 *   PENDING → PROCESSING → COMPLETED
 *          ↘               ↗
 *           → FAILED → REVERSED
 *
 *  PENDING:    Transfer criada, OutboxEvent persistido. Aguardando
 *              o OutboxPublisher publicar no Kafka.
 *
 *  PROCESSING: Evento publicado no Kafka. Bank B recebeu e está
 *              processando o crédito no destinatário.
 *
 *  COMPLETED:  Bank B confirmou o crédito via `pix.transfer.completed`.
 *
 *  FAILED:     Bank B rejeitou (PIX key inválida, conta inexistente).
 *              Saldo do remetente deve ser estornado.
 *
 *  REVERSED:   Estorno concluído após falha.
 *
 * RASTREABILIDADE:
 * ─────────────────────────────────────────────────────────────────
 * `correlationId` carrega o W3C traceparent trace-id, propagado de
 * HTTP header → Kafka header → Bank B → resposta. Permite correlacionar
 * todos os logs de uma única transferência em ambos os bancos.
 */
@Schema({ timestamps: true, collection: 'transfers' })
export class Transfer {
  /** UUID v4 — chave de idempotência entre os bancos */
  @Prop({ required: true, unique: true })
  transferId: string;

  @Prop({ required: true })
  senderAccountNumber: string;

  /** Chave PIX do remetente — armazenada para exibição no extrato */
  @Prop({ required: true })
  senderPixKey: string;

  @Prop({ required: true })
  receiverPixKey: string;

  /** Número de conta do destinatário quando resolvido (preenchido após confirmação do Bank B) */
  @Prop()
  receiverAccountNumber?: string;

  /** Valor em centavos — inteiro para evitar imprecisão de ponto flutuante */
  @Prop({ required: true, min: 1 })
  amount: number;

  @Prop({ trim: true, maxlength: 140 })
  description?: string;

  @Prop({ enum: TransferStatus, default: TransferStatus.PENDING })
  status: TransferStatus;

  @Prop({ enum: TransferDirection, required: true })
  direction: TransferDirection;

  /** W3C traceparent trace-id para rastreamento distribuído entre bancos */
  @Prop()
  correlationId?: string;

  /** Mensagem de erro quando status = FAILED */
  @Prop()
  failureReason?: string;

  @Prop()
  completedAt?: Date;
}

export const TransferSchema = SchemaFactory.createForClass(Transfer);

// Consultas mais comuns: extrato do usuário (mais recentes primeiro)
TransferSchema.index({ senderAccountNumber: 1, createdAt: -1 });
// Filtro por status para workers de retry/reconciliação
TransferSchema.index({ status: 1, createdAt: 1 });
// Rastreamento distribuído
TransferSchema.index({ correlationId: 1 });
// Nota: { transferId: 1 } não é declarado aqui — unique:true no @Prop já cria o índice único
