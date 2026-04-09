import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import { AccountService } from '../account/account.service';
import { TypedConfigService } from '../../config';
import type { JwtPayload } from './strategies/jwt.strategy';
import type { RegisterInput } from './dto/register.input';
import type { UserDocument } from '../account/schemas/user.schema';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends AuthTokens {
  user: UserDocument;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly accountService: AccountService,
    private readonly jwtService: JwtService,
    private readonly config: TypedConfigService,
  ) {}

  /**
   * Registra um novo usuário e retorna tokens + documento criado.
   * A criação do usuário (incluindo hash da senha) é delegada ao AccountService
   * para manter a responsabilidade de persistência separada da autenticação.
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    const user = await this.accountService.createUser(input);
    const tokens = this.signTokens({
      sub: (user._id as unknown as { toString(): string }).toString(),
      accountNumber: user.accountNumber,
      email: user.email,
    });
    return { ...tokens, user };
  }

  /**
   * Valida credenciais e retorna o payload JWT se válidas.
   *
   * A mensagem de erro é PROPOSITALMENTE genérica ("Invalid credentials")
   * para não revelar ao atacante se o e-mail existe ou não no sistema
   * (user enumeration attack prevention).
   */
  async validateUser(email: string, password: string): Promise<JwtPayload> {
    const user = await this.accountService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    return {
      sub: (user._id as unknown as { toString(): string }).toString(),
      accountNumber: user.accountNumber,
      email: user.email,
      iat: 0,
      exp: 0,
    };
  }

  /**
   * Autentica um usuário existente e retorna tokens + documento.
   */
  async login(email: string, password: string): Promise<AuthResult> {
    const payload = await this.validateUser(email, password);
    const user = await this.accountService.findByEmail(email);
    const tokens = this.signTokens({
      sub: payload.sub,
      accountNumber: payload.accountNumber,
      email: payload.email,
    });
    return { ...tokens, user: user! };
  }

  /**
   * Assina access (15m) e refresh (7d) tokens usando RS256.
   *
   * RS256 usa criptografia assimétrica:
   *  - Assinar: chave PRIVADA (só o Bank A possui)
   *  - Verificar: chave PÚBLICA (qualquer serviço pode ter)
   *
   * Isso significa que o Bank B pode verificar tokens do Bank A sem
   * nunca ter acesso à chave privada — princípio de menor privilégio.
   */
  signTokens(payload: Omit<JwtPayload, 'iat' | 'exp'>): AuthTokens {
    const privateKey = this.config.get('JWT_PRIVATE_KEY').replace(/\\n/g, '\n');

    const baseOptions: JwtSignOptions = {
      privateKey,
      algorithm: 'RS256',
    };

    const accessToken = this.jwtService.sign(payload, {
      ...baseOptions,
      expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN') as StringValue,
    });

    const refreshToken = this.jwtService.sign(
      { sub: payload.sub },
      {
        ...baseOptions,
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN') as StringValue,
      },
    );

    return { accessToken, refreshToken };
  }
}
