import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AccountService } from '../account/account.service';
import { RegisterInput } from './dto/register.input';
import { LoginInput } from './dto/login.input';
import { AuthPayload } from './dto/auth-payload.type';
import { UserType } from '../account/dto/user.type';
import { toUserType } from '../account/account.resolver';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { JwtPayload } from './strategies/jwt.strategy';

@Resolver()
export class AuthResolver {
  constructor(
    private readonly authService: AuthService,
    private readonly accountService: AccountService,
  ) {}

  /**
   * Registra um novo usuário e retorna tokens de acesso imediatamente.
   *
   * Fluxo:
   *  1. `ValidationPipe` valida o `RegisterInput` via `class-validator`
   *  2. `AuthService.register()` chama `AccountService.createUser()`
   *  3. `AccountService` hasha a senha com bcrypt (12 rounds)
   *  4. O documento é salvo no MongoDB
   *  5. `AuthService` assina os tokens JWT RS256
   *  6. Retornamos `AuthPayload` sem nunca expor `passwordHash`
   */
  @Mutation(() => AuthPayload, {
    description: 'Cria uma nova conta bancária e retorna tokens JWT',
  })
  async register(@Args('input') input: RegisterInput): Promise<AuthPayload> {
    const { accessToken, refreshToken, user } = await this.authService.register(input);
    return { accessToken, refreshToken, user: toUserType(user) };
  }

  /**
   * Autentica um usuário existente.
   *
   * Segurança: a mensagem de erro em caso de falha é genérica em ambos
   * os casos (email não encontrado E senha errada) para evitar user
   * enumeration — um atacante não consegue distinguir se o e-mail existe.
   */
  @Mutation(() => AuthPayload, {
    description: 'Autentica com email/senha e retorna tokens JWT',
  })
  async login(@Args('input') input: LoginInput): Promise<AuthPayload> {
    const { accessToken, refreshToken, user } = await this.authService.login(
      input.email,
      input.password,
    );
    return { accessToken, refreshToken, user: toUserType(user) };
  }

  /**
   * Retorna o perfil do usuário autenticado.
   *
   * `@UseGuards(JwtAuthGuard)` intercepta a requisição antes do resolver:
   *  1. Extrai o Bearer token do header Authorization
   *  2. Verifica a assinatura RS256 com a chave pública
   *  3. Decodifica o payload e popula `req.user`
   *
   * `@CurrentUser()` então lê `req.user` e injeta como parâmetro.
   * Se o token estiver ausente ou inválido, o guard lança `UnauthorizedException`
   * e o resolver nunca é chamado.
   */
  @Query(() => UserType, {
    description: 'Retorna o perfil do usuário autenticado (requer JWT)',
  })
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() jwtUser: JwtPayload): Promise<UserType> {
    // Buscamos o documento atualizado do banco — o token pode estar desatualizado
    // se o usuário mudou dados após o login (ex: saldo alterado por uma transferência)
    const user = await this.accountService.findById(jwtUser.sub);
    return toUserType(user);
  }
}
