import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

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

  /** Returns the balance in cents */
  async getBalance(accountNumber: string): Promise<number> {
    const user = await this.findByAccountNumber(accountNumber);
    return user.balance;
  }
}
