import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

/**
 * Schema do usuário/conta do Banco A — armazena saldo e identidade.
 *
 * LOCK OTIMISTA (Optimistic Concurrency Control):
 * ─────────────────────────────────────────────
 * O MongoDB não tem SELECT ... FOR UPDATE como o PostgreSQL. Para prevenir
 * o "lost update problem" em atualizações concorrentes de saldo, usamos
 * o mecanismo de versioning do Mongoose:
 *
 *   1. `optimisticConcurrency: true` — quando `user.save()` é chamado,
 *      o Mongoose automaticamente inclui `{ __v: <valor atual> }` no filtro
 *      da query de update. Exemplo gerado internamente:
 *
 *        db.users.updateOne(
 *          { _id: ObjectId("..."), __v: 2 },   ← check-and-set
 *          { $set: { balance: 9000 }, $inc: { __v: 1 } }
 *        )
 *
 *   2. Se outro processo já modificou o documento (incrementando `__v` para 3),
 *      a query não encontra o documento (filtro `__v: 2` falha) e o Mongoose
 *      lança `VersionError`.
 *
 *   3. O TransferService usa `findOneAndUpdate` com `$inc: { balance: -amount }`
 *      + filtro `balance: { $gte: amount }` — operação atômica que não depende
 *      de `save()`. Para esse caso o lock otimista funciona como defense-in-depth:
 *      protege qualquer `save()` que aconteça fora da transação de transferência.
 *
 * SALDO EM CENTAVOS:
 * ─────────────────
 * `balance` é armazenado como inteiro em centavos para evitar erros de
 * ponto flutuante. R$100,50 → 10050. O frontend é responsável por dividir por 100.
 */
@Schema({
  timestamps: true,
  collection: 'users',
  /**
   * Ativa o lock otimista no Mongoose 7+.
   * Faz com que `.save()` inclua `__v` no filtro e lance `VersionError`
   * se o documento foi modificado por outro processo entre o `findOne` e o `save`.
   */
  optimisticConcurrency: true,
})
export class User {
  @Prop({ required: true, unique: true, trim: true })
  accountNumber: string;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  /** Saldo em centavos. 10050 = R$100,50 */
  @Prop({ required: true, default: 0, min: 0 })
  balance: number;

  @Prop({ default: true })
  isActive: boolean;

  /**
   * Chave PIX — índice único.
   * `unique: true` já cria o índice no MongoDB; declaração em SchemaFactory.index()
   * seria redundante e geraria warning do Mongoose.
   */
  @Prop({ required: true, unique: true })
  pixKey: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
