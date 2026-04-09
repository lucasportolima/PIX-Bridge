import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Input para a mutation `register`.
 *
 * `@InputType()` faz o GraphQL gerar o tipo `RegisterInput` no schema SDL.
 * `class-validator` valida os campos *antes* do resolver ser chamado,
 * graças ao `ValidationPipe` global registrado em `main.ts`.
 */
@InputType()
export class RegisterInput {
  @Field()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName: string;

  @Field()
  @IsEmail()
  @MaxLength(254)
  email: string;

  /**
   * Senha mínima de 8 caracteres com ao menos uma letra e um dígito.
   * A regex não é excessivamente restritiva para não frustrar usuários,
   * mas garante um nível mínimo de entropia.
   */
  @Field()
  @MinLength(8)
  @MaxLength(72) // bcrypt silently truncates beyond 72 bytes
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password: string;

  /**
   * Chave PIX — pode ser CPF, e-mail, telefone ou UUID.
   * Validação de formato delegada a regras de negócio futuras;
   * aqui apenas garantimos que não está vazia.
   */
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(77)
  pixKey: string;
}
