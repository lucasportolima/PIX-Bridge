import { Field, ObjectType } from '@nestjs/graphql';

// UserType pertence ao domínio Account — importamos e re-exportamos
// para não quebrar imports existentes e deixar a dependência explícita.
export { UserType } from '../../account/dto/user.type';
import { UserType } from '../../account/dto/user.type';

/**
 * Payload retornado pelas mutations `register` e `login`.
 *
 * Boas práticas de segurança para o cliente:
 *  - `accessToken`: guardar em memória (variável JS), não em localStorage
 *    (vulnerável a XSS). Válido por 15 minutos.
 *  - `refreshToken`: idealmente em cookie httpOnly (não implementado neste POC).
 *    Válido por 7 dias.
 */
@ObjectType()
export class AuthPayload {
  @Field()
  accessToken: string;

  @Field()
  refreshToken: string;

  @Field(() => UserType)
  user: UserType;
}
