import { Field, Float, ObjectType } from '@nestjs/graphql';

/**
 * Projeção pública do usuário exposta via GraphQL.
 *
 * Nunca expõe `passwordHash` — o campo existe no documento MongoDB
 * mas não é declarado aqui, então o GraphQL nunca o inclui no schema.
 *
 * `balance` é retornado em centavos para o cliente converter (R$100 = 10000).
 */
@ObjectType()
export class UserType {
  @Field()
  id: string;

  @Field()
  accountNumber: string;

  @Field()
  fullName: string;

  @Field()
  email: string;

  @Field()
  pixKey: string;

  @Field(() => Float)
  balance: number;

  @Field()
  isActive: boolean;
}

/**
 * Payload retornado pelas mutations `register` e `login`.
 *
 * O cliente deve:
 *  - Guardar `accessToken` em memória (não em localStorage — XSS risk)
 *  - Guardar `refreshToken` em httpOnly cookie (não implementado neste POC)
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
