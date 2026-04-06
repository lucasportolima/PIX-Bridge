import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthGuard } from '@nestjs/passport';

/**
 * Adapts the standard Passport JWT guard to work with GraphQL context.
 * NestJS HTTP guards receive `req` from `context.switchToHttp()`, but
 * GraphQL resolvers receive it from the Apollo context object — this override
 * bridges the two so `@UseGuards(JwtAuthGuard)` works on both REST and GQL.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  getRequest(context: ExecutionContext) {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext<{ req: Request }>().req;
  }
}
