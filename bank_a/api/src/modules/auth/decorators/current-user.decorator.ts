import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { JwtPayload } from '../strategies/jwt.strategy';

/**
 * Decorator de parâmetro que extrai o usuário autenticado do contexto GraphQL.
 *
 * Como usar em um resolver:
 * ```typescript
 * @Query(() => UserType)
 * @UseGuards(JwtAuthGuard)
 * me(@CurrentUser() user: JwtPayload): UserType { ... }
 * ```
 *
 * O `JwtAuthGuard` executa *antes* do resolver e popula `req.user` com o
 * payload decodificado pelo `JwtStrategy.validate()`. Este decorator apenas
 * lê esse valor — não faz nenhuma validação extra.
 *
 * O `createParamDecorator` recebe dois parâmetros:
 *  - `data`: argumento opcional passado ao decorator (ex: @CurrentUser('email'))
 *  - `ctx`: contexto de execução do NestJS (HTTP, GraphQL, RPC, etc.)
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | JwtPayload[keyof JwtPayload] => {
    const gqlCtx = GqlExecutionContext.create(ctx);
    const req = gqlCtx.getContext<{ req: Express.Request & { user: JwtPayload } }>().req;
    const user = req.user;

    // Se o decorator receber um campo específico (@CurrentUser('email')),
    // retorna apenas esse campo em vez do payload completo.
    return data ? user[data] : user;
  },
);
