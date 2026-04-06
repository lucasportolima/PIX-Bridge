import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transfer, TransferSchema } from './schemas/transfer.schema';
import { User, UserSchema } from '../account/schemas/user.schema';
import { TransferService } from './transfer.service';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transfer.name, schema: TransferSchema },
      // Also registers User here so TransferService can inject the UserModel for balance debit
      { name: User.name, schema: UserSchema },
    ]),
    OutboxModule,
  ],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransferModule {}
