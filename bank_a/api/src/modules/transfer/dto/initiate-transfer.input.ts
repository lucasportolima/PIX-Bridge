import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

@InputType()
export class InitiateTransferInput {
  @Field({ description: 'Chave PIX do destinatário (CPF, e-mail, telefone ou UUID)' })
  @IsString()
  @MinLength(1)
  @MaxLength(77)
  receiverPixKey: string;

  /**
   * Valor em centavos (inteiro).
   * R$10,00 = 1000 centavos. Mínimo: 1 centavo (R$0,01).
   *
   * Usamos inteiro para eliminar imprecisão de ponto flutuante:
   *   0.1 + 0.2 = 0.30000000000000004  ← bug clássico com Float
   *   1000 + 2000 = 3000               ← sempre exato com Int
   */
  @Field(() => Int, { description: 'Valor em centavos (ex: 1000 = R$10,00)' })
  @IsInt()
  @Min(1, { message: 'O valor mínimo de transferência é R$0,01 (1 centavo)' })
  amountCents: number;

  @Field({ nullable: true, description: 'Descrição opcional (máx. 140 caracteres)' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  description?: string;
}
