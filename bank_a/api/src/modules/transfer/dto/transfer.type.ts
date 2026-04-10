import { Field, Float, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { TransferDirection, TransferStatus } from '../schemas/transfer.schema';

/**
 * Registra os enums no schema GraphQL do Apollo.
 * Sem esse registro, `@Field(() => TransferStatus)` não funciona —
 * o Apollo não sabe como serializar/deserializar o enum.
 */
registerEnumType(TransferStatus, {
  name: 'TransferStatus',
  description: 'Ciclo de vida de uma transferência PIX',
  valuesMap: {
    PENDING: { description: 'Aguardando publicação no Kafka' },
    PROCESSING: { description: 'Bank B recebeu e está processando' },
    COMPLETED: { description: 'Crédito confirmado pelo Bank B' },
    FAILED: { description: 'Bank B rejeitou a transferência' },
    REVERSED: { description: 'Saldo estornado ao remetente' },
  },
});

registerEnumType(TransferDirection, {
  name: 'TransferDirection',
  valuesMap: {
    OUTBOUND: { description: 'Bank A → Bank B' },
    INBOUND: { description: 'Bank B → Bank A' },
  },
});

@ObjectType({ description: 'Registro de uma transferência PIX' })
export class TransferType {
  @Field({ description: 'ID interno MongoDB' })
  id: string;

  @Field({ description: 'UUID v4 — chave de idempotência entre os bancos' })
  transferId: string;

  @Field()
  senderAccountNumber: string;

  @Field()
  senderPixKey: string;

  @Field()
  receiverPixKey: string;

  @Field({ nullable: true, description: 'Número da conta do destinatário (quando resolvido)' })
  receiverAccountNumber?: string;

  @Field(() => Int, { description: 'Valor em centavos' })
  amountCents: number;

  /** Valor formatado para exibição direta no frontend sem lógica de formatação */
  @Field({ description: 'Valor formatado em BRL (ex: R$ 100,50)' })
  amountFormatted: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => TransferStatus)
  status: TransferStatus;

  @Field(() => TransferDirection)
  direction: TransferDirection;

  @Field({ nullable: true, description: 'W3C traceparent trace-id para rastreamento' })
  correlationId?: string;

  @Field({ nullable: true })
  failureReason?: string;

  @Field({ description: 'Data de criação ISO 8601' })
  createdAt: string;

  @Field({ nullable: true, description: 'Data de conclusão ISO 8601' })
  completedAt?: string;
}

/** Resultado paginado de transferências */
@ObjectType()
export class TransferPage {
  @Field(() => [TransferType])
  items: TransferType[];

  @Field(() => Int, { description: 'Total de registros (sem paginação)' })
  total: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  offset: number;
}
