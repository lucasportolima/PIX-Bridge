import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

/**
 * Represents a bank account holder in Bank A (MongoDB).
 * Balance is stored in cents (integer) to avoid floating-point arithmetic issues.
 * `__v` is Mongoose's built-in version key — used for optimistic concurrency control.
 */
@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, trim: true })
  accountNumber: string;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  /** Balance in cents. e.g. 10000 = R$100.00 */
  @Prop({ required: true, default: 0, min: 0 })
  balance: number;

  @Prop({ default: true })
  isActive: boolean;

  // unique: true already creates the index — no need for SchemaFactory.index()
  @Prop({ required: true, unique: true })
  pixKey: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
