import { Query, Resolver } from '@nestjs/graphql';

/**
 * Minimal resolver required by GraphQL schema auto-generation.
 * Will be expanded with full account queries/mutations in TASK-05.
 */
@Resolver()
export class AccountResolver {
  @Query(() => String, { description: 'Health check para o schema GraphQL' })
  ping(): string {
    return 'pong';
  }
}
