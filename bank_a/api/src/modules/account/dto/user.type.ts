import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

/**
 * Projeção pública da conta bancária exposta via GraphQL.
 *
 * Regra fundamental: `passwordHash` NUNCA aparece aqui.
 * O campo existe no MongoDB mas não tem `@Field()` — o Apollo Server
 * simplesmente não o inclui no schema SDL e nunca o serializa.
 *
 * `balance` é exposto em centavos (Int) para preservar precisão.
 * O cliente é responsável pela formatação: `balance / 100` → R$
 *
 * Usamos `Int` (não `Float`) porque centavos são sempre inteiros —
 * Float poderia introduzir imprecisão de ponto flutuante na serialização.
 */
@ObjectType({ description: 'Perfil público de uma conta bancária' })
export class UserType {
  @Field({ description: 'ID interno MongoDB (ObjectId como string)' })
  id: string;

  @Field({ description: 'Número da conta no formato ACC-XXXXXXXX' })
  accountNumber: string;

  @Field()
  fullName: string;

  @Field()
  email: string;

  @Field({ description: 'Chave PIX cadastrada' })
  pixKey: string;

  /**
   * Saldo em centavos. Ex: 10050 = R$100,50
   * Retornamos Float para compatibilidade com clientes que já esperam esse tipo.
   * A precisão é garantida pelo armazenamento como inteiro no MongoDB.
   */
  @Field(() => Float, { description: 'Saldo em centavos (ex: 10050 = R$100,50)' })
  balance: number;

  @Field()
  isActive: boolean;
}

/**
 * Tipo simplificado para lookups de destinatário (ex: confirmar destinatário
 * antes de uma transferência sem expor todos os dados da conta).
 */
@ObjectType({ description: 'Dados públicos mínimos de um destinatário PIX' })
export class RecipientType {
  @Field()
  accountNumber: string;

  @Field()
  fullName: string;

  @Field()
  pixKey: string;
}

/** Resumo de saldo — retornado pela query `myBalance` */
@ObjectType()
export class BalanceSummary {
  @Field(() => Int, { description: 'Saldo em centavos' })
  balanceCents: number;

  @Field({ description: 'Saldo formatado em reais (ex: "R$ 100,50")' })
  balanceFormatted: string;

  @Field({ description: 'Número da conta' })
  accountNumber: string;
}
