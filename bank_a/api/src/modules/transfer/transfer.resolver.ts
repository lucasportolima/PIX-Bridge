import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { TransferService } from './transfer.service';
import { AccountService } from '../account/account.service';
import { InitiateTransferInput } from './dto/initiate-transfer.input';
import { TransferPage, TransferType } from './dto/transfer.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import type { TransferDocument } from './schemas/transfer.schema';

/**
 * Formata centavos em string BRL.
 * Centralizada aqui para uso exclusivo deste resolver.
 * A função idêntica no AccountResolver será movida para um util compartilhado
 * em uma task futura de refactoring.
 */
function formatBRL(cents: number): string {
  const reais = Math.floor(cents / 100);
  const centavos = cents % 100;
  return `R$ ${reais.toLocaleString('pt-BR')},${String(centavos).padStart(2, '0')}`;
}

/** Converte TransferDocument do Mongoose → TransferType do GraphQL */
function toTransferType(doc: TransferDocument): TransferType {
  const t = new TransferType();
  t.id = (doc._id as unknown as { toString(): string }).toString();
  t.transferId = doc.transferId;
  t.senderAccountNumber = doc.senderAccountNumber;
  t.senderPixKey = doc.senderPixKey;
  t.receiverPixKey = doc.receiverPixKey;
  t.receiverAccountNumber = doc.receiverAccountNumber;
  t.amountCents = doc.amount;
  t.amountFormatted = formatBRL(doc.amount);
  t.description = doc.description;
  t.status = doc.status;
  t.direction = doc.direction;
  t.correlationId = doc.correlationId;
  t.failureReason = doc.failureReason;
  // `doc.createdAt` vem de `timestamps: true` do Mongoose — é um Date
  t.createdAt = (doc as unknown as { createdAt: Date }).createdAt?.toISOString() ?? new Date().toISOString();
  t.completedAt = doc.completedAt?.toISOString();
  return t;
}

@Resolver()
export class TransferResolver {
  constructor(
    private readonly transferService: TransferService,
    private readonly accountService: AccountService,
  ) {}

  /**
   * Inicia uma transferência PIX para o Bank B.
   *
   * IMPORTANTE — o que acontece internamente:
   *
   *  1. `@UseGuards(JwtAuthGuard)` valida o token antes de qualquer lógica
   *  2. `@CurrentUser()` injeta o payload do JWT (contém accountNumber)
   *  3. Buscamos o documento do usuário para obter a `senderPixKey`
   *  4. Abrimos uma sessão MongoDB e iniciamos uma transação:
   *       a. Debitamos o saldo com `findOneAndUpdate` atômico
   *       b. Criamos o `TransferDocument` com status PENDING
   *       c. Persistimos um `OutboxEvent` para publicação no Kafka
   *  5. Retornamos o `TransferDocument` criado
   *
   * Se o saldo for insuficiente → BadRequestException → rollback automático.
   * Se o MongoDB falhar → rollback automático → saldo preservado.
   *
   * O cliente deve fazer polling em `transferById` para acompanhar a
   * evolução do status (PENDING → PROCESSING → COMPLETED/FAILED).
   */
  @Mutation(() => TransferType, {
    description: 'Inicia uma transferência PIX de saída (Bank A → Bank B)',
  })
  @UseGuards(JwtAuthGuard)
  async initiateTransfer(
    @Args('input') input: InitiateTransferInput,
    @CurrentUser() jwtUser: JwtPayload,
  ): Promise<TransferType> {
    // Buscamos o usuário para obter a senderPixKey — necessária para o extrato
    const sender = await this.accountService.findById(jwtUser.sub);

    const transfer = await this.transferService.initiateOutbound({
      senderAccountNumber: sender.accountNumber,
      senderPixKey: sender.pixKey,
      receiverPixKey: input.receiverPixKey,
      amountCents: input.amountCents,
      description: input.description,
      // Em produção, propagaríamos o traceparent do header HTTP
      correlationId: `${jwtUser.sub}-${Date.now()}`,
    });

    return toTransferType(transfer);
  }

  /**
   * Retorna o extrato paginado de transferências da conta autenticada.
   *
   * `limit` e `offset` são opcionais — padrão: 20 itens, a partir do início.
   * O campo `total` permite ao frontend calcular o número de páginas.
   */
  @Query(() => TransferPage, {
    description: 'Extrato paginado de transferências da conta autenticada',
  })
  @UseGuards(JwtAuthGuard)
  async myTransfers(
    @CurrentUser() jwtUser: JwtPayload,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset: number,
  ): Promise<TransferPage> {
    const sender = await this.accountService.findById(jwtUser.sub);
    const { items, total } = await this.transferService.findByAccount(
      sender.accountNumber,
      limit,
      offset,
    );

    const page = new TransferPage();
    page.items = items.map(toTransferType);
    page.total = total;
    page.limit = limit;
    page.offset = offset;
    return page;
  }

  /**
   * Busca uma transferência específica pelo `transferId` (UUID).
   * Usado pelo frontend para fazer polling de status após `initiateTransfer`.
   *
   * Protegido por JWT — qualquer usuário autenticado pode buscar qualquer
   * transferência pelo ID. Em produção, validaríamos que o requester é
   * o sender ou o receiver da transferência.
   */
  @Query(() => TransferType, {
    description: 'Busca uma transferência pelo ID (para polling de status)',
  })
  @UseGuards(JwtAuthGuard)
  async transferById(
    @Args('transferId') transferId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @CurrentUser() _jwtUser: JwtPayload,
  ): Promise<TransferType> {
    const transfer = await this.transferService.findByTransferId(transferId);
    return toTransferType(transfer);
  }
}
