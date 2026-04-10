import { Args, Query, Resolver } from '@nestjs/graphql';
import { NotFoundException, UseGuards } from '@nestjs/common';
import { AccountService } from './account.service';
import { UserType, BalanceSummary, RecipientType } from './dto/user.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import type { UserDocument } from './schemas/user.schema';

/**
 * Converte um UserDocument do Mongoose para o tipo público UserType do GraphQL.
 * Centralizada aqui para não duplicar a lógica entre AccountResolver e AuthResolver.
 */
export function toUserType(user: UserDocument): UserType {
  const userType = new UserType();
  userType.id = (user._id as unknown as { toString(): string }).toString();
  userType.accountNumber = user.accountNumber;
  userType.fullName = user.fullName;
  userType.email = user.email;
  userType.pixKey = user.pixKey;
  userType.balance = user.balance;
  userType.isActive = user.isActive;
  return userType;
}

/**
 * Formata centavos em string legível em BRL.
 * Exemplo: 10050 → "R$ 100,50"
 *
 * Não usamos `Intl.NumberFormat` no backend para evitar diferenças de
 * localização entre ambientes. A formatação é explícita e determinística.
 */
function formatBRL(cents: number): string {
  const reais = Math.floor(cents / 100);
  const centavos = cents % 100;
  return `R$ ${reais.toLocaleString('pt-BR')},${String(centavos).padStart(2, '0')}`;
}

@Resolver()
export class AccountResolver {
  constructor(private readonly accountService: AccountService) {}

  /** Health check — mantido para smoke test do schema GraphQL */
  @Query(() => String, { description: 'Verifica conectividade com a API' })
  ping(): string {
    return 'pong';
  }

  /**
   * Retorna o perfil completo da conta autenticada.
   *
   * Diferença em relação à query `me` do AuthResolver:
   * - `me` (Auth): retorna o perfil do usuário autenticado
   * - `myAccount` (Account): semanticamente igual, mas este é o ponto
   *   de extensão futuro para campos específicos de conta (limite diário,
   *   nível de verificação, etc.)
   *
   * Sempre busca o documento atualizado no banco — o JWT pode estar
   * desatualizado se o saldo mudou após o login.
   */
  @Query(() => UserType, {
    description: 'Retorna o perfil completo da conta autenticada',
  })
  @UseGuards(JwtAuthGuard)
  async myAccount(@CurrentUser() jwtUser: JwtPayload): Promise<UserType> {
    const user = await this.accountService.findById(jwtUser.sub);
    return toUserType(user);
  }

  /**
   * Retorna o saldo atual da conta autenticada com formatação.
   *
   * Por que uma query dedicada ao invés de usar `myAccount.balance`?
   * - Polling de saldo é uma operação frequente no frontend — uma query
   *   mínima é mais eficiente do que trazer todos os campos do usuário
   * - O `BalanceSummary` encapsula tanto o valor bruto (centavos) quanto
   *   o valor formatado, evitando que o frontend precise formatar
   */
  @Query(() => BalanceSummary, {
    description: 'Retorna saldo atual em centavos e formatado em BRL',
  })
  @UseGuards(JwtAuthGuard)
  async myBalance(@CurrentUser() jwtUser: JwtPayload): Promise<BalanceSummary> {
    const user = await this.accountService.findById(jwtUser.sub);
    const summary = new BalanceSummary();
    summary.balanceCents = user.balance;
    summary.balanceFormatted = formatBRL(user.balance);
    summary.accountNumber = user.accountNumber;
    return summary;
  }

  /**
   * Busca um destinatário PIX pela chave — usado pelo frontend para
   * confirmar o destinatário antes de iniciar uma transferência.
   *
   * Retorna apenas dados públicos (`RecipientType`) — nunca email, saldo
   * ou ID interno. Isso segue o princípio de menor exposição de dados.
   *
   * Protegido por JWT: apenas usuários autenticados podem buscar contas.
   * Sem autenticação seria um vetor de enumeração de usuários (OWASP API3).
   */
  @Query(() => RecipientType, {
    nullable: true,
    description: 'Busca destinatário por chave PIX (para confirmar antes de transferir)',
  })
  @UseGuards(JwtAuthGuard)
  async recipientByPixKey(
    @Args('pixKey') pixKey: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @CurrentUser() _jwtUser: JwtPayload,
  ): Promise<RecipientType | null> {
    const user = await this.accountService.findByPixKey(pixKey);
    if (!user) return null;

    const recipient = new RecipientType();
    recipient.accountNumber = user.accountNumber;
    recipient.fullName = user.fullName;
    recipient.pixKey = user.pixKey;
    return recipient;
  }

  /**
   * Busca conta pelo número — uso interno / administrativo.
   * Retorna perfil completo (protegido por JWT).
   */
  @Query(() => UserType, {
    nullable: true,
    description: 'Busca conta pelo número da conta (uso interno)',
  })
  @UseGuards(JwtAuthGuard)
  async accountByNumber(
    @Args('accountNumber') accountNumber: string,
    @CurrentUser() jwtUser: JwtPayload,
  ): Promise<UserType> {
    // Por ora qualquer usuário autenticado pode buscar qualquer conta.
    // Em produção isso seria restrito a admins ou ao próprio titular.
    void jwtUser;
    try {
      const user = await this.accountService.findByAccountNumber(accountNumber);
      return toUserType(user);
    } catch {
      throw new NotFoundException(`Account ${accountNumber} not found`);
    }
  }
}
