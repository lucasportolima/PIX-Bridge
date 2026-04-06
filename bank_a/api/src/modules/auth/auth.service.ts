import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import { AccountService } from '../account/account.service';
import { TypedConfigService } from '../../config';
import { JwtPayload } from './strategies/jwt.strategy';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly accountService: AccountService,
    private readonly jwtService: JwtService,
    private readonly config: TypedConfigService,
  ) {}

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
   * Signs access (15m) and refresh (7d) tokens using RS256.
   * The private key is loaded from the environment to support key rotation.
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
