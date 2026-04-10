import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
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

  /**
   * Debita `amountCents` do saldo do remetente de forma atômica.
   *
   * Usa `findOneAndUpdate` com filtro `balance: { $gte: amountCents }` —
   * isso é um check-and-set atômico no MongoDB: a operação só executa
   * se o saldo for suficiente, e o próprio MongoDB garante atomicidade
   * em operações de documento único.
   *
   * Deve ser chamado DENTRO de uma sessão de transação do `TransferService`
   * para garantir que o débito e a criação do OutboxEvent sejam atômicos.
   *
   * @param accountNumber - conta do remetente
   * @param amountCents - valor a debitar em centavos
   * @param session - sessão MongoDB da transação em andamento
   * @returns documento atualizado com novo saldo
   * @throws BadRequestException se saldo insuficiente ou conta inativa
   */
  async debitBalance(
    accountNumber: string,
    amountCents: number,
    session: ClientSession,
  ): Promise<UserDocument> {
    const updated = await this.userModel
      .findOneAndUpdate(
        {
          accountNumber,
          isActive: true,
          balance: { $gte: amountCents }, // saldo suficiente — check atômico
        },
        {
          $inc: { balance: -amountCents },
        },
        {
          new: true, // retorna o documento APÓS a atualização
          session,
        },
      )
      .exec();

    if (!updated) {
      // A query não encontrou o documento. Pode ser:
      //   1. Conta não existe
      //   2. Conta inativa
      //   3. Saldo insuficiente
      // Verificamos qual caso para dar uma mensagem útil.
      const account = await this.userModel.findOne({ accountNumber }).session(session).exec();
      if (!account) throw new NotFoundException(`Account ${accountNumber} not found`);
      if (!account.isActive) throw new BadRequestException('Account is not active');
      throw new BadRequestException(
        `Insufficient balance. Available: ${account.balance} cents, requested: ${amountCents} cents`,
      );
    }

    return updated;
  }

  /**
   * Credita `amountCents` no saldo do destinatário.
   * Operação atômica — não verifica saldo mínimo (crédito nunca falha por saldo).
   */
  async creditBalance(
    accountNumber: string,
    amountCents: number,
    session: ClientSession,
  ): Promise<UserDocument> {
    const updated = await this.userModel
      .findOneAndUpdate(
        { accountNumber, isActive: true },
        { $inc: { balance: amountCents } },
        { new: true, session },
      )
      .exec();

    if (!updated) throw new NotFoundException(`Account ${accountNumber} not found or inactive`);
    return updated;
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

  /** Retorna o saldo atual em centavos */
  async getBalance(accountNumber: string): Promise<number> {
    const user = await this.findByAccountNumber(accountNumber);
    return user.balance;
  }
}
