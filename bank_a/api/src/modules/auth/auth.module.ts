import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AccountModule } from '../account/account.module';
import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/**
 * JwtModule é registrado SEM secret/key aqui porque cada chamada a `sign()`
 * fornece a chave privada explicitamente via JwtSignOptions.
 * Isso evita o risco de usar acidentalmente o algoritmo ou chave errada
 * se múltiplos tipos de token coexistirem no futuro (ex: email confirmation tokens).
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    AccountModule,
  ],
  providers: [AuthService, AuthResolver, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
