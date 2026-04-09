import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { User, UserDocument } from './schemas/user.schema';
import type { RegisterInput } from '../auth/dto/register.input';

/**
 * Custo do bcrypt — 12 rounds é o valor recomendado para produção em 2024.
 * Cada incremento de 1 dobra o tempo de hashing:
 *   10 rounds ≈ 100ms, 12 rounds ≈ 400ms, 14 rounds ≈ 1.5s
 * O custo alto é INTENCIONAL — dificulta ataques de força bruta mesmo com
 * a base de dados comprometida.
 */
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Cria um novo usuário com senha hasheada.
   *
   * Verificações de unicidade são feitas antes do insert para retornar
   * erros semânticos claros (ConflictException) em vez de erros de índice
   * do MongoDB (que são mais difíceis de tratar no cliente GraphQL).
   */
  async createUser(input: RegisterInput): Promise<UserDocument> {
    const [emailExists, pixKeyExists] = await Promise.all([
      this.userModel.exists({ email: input.email.toLowerCase() }),
      this.userModel.exists({ pixKey: input.pixKey }),
    ]);

    if (emailExists) throw new ConflictException('Email already registered');
    if (pixKeyExists) throw new ConflictException('PIX key already in use');

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    // Gera número de conta no formato ACC-XXXX (primeiros 8 chars do UUID)
    const accountNumber = `ACC-${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const user = await this.userModel.create({
      accountNumber,
      fullName: input.fullName,
      email: input.email.toLowerCase(),
      passwordHash,
      pixKey: input.pixKey,
      balance: 0,
      isActive: true,
    });

    this.logger.log({ accountNumber, email: user.email }, 'New user registered');
    return user;
  }

  async findByAccountNumber(accountNumber: string): Promise<UserDocument> {
    const user = await this.userModel.findOne({ accountNumber }).exec();
    if (!user) throw new NotFoundException(`Account ${accountNumber} not found`);
    return user;
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findByPixKey(pixKey: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ pixKey }).exec();
  }

  async findById(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id).exec();
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  /** Returns the balance in cents */
  async getBalance(accountNumber: string): Promise<number> {
    const user = await this.findByAccountNumber(accountNumber);
    return user.balance;
  }
}
