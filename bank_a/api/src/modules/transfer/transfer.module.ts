import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transfer, TransferSchema } from './schemas/transfer.schema';
import { TransferService } from './transfer.service';
import { TransferResolver } from './transfer.resolver';
import { AccountModule } from '../account/account.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Transfer.name, schema: TransferSchema }]),
    // AccountModule exporta AccountService, necessário para:
    //   - TransferService.initiateOutbound → debitBalance (debita saldo via sessão)
    //   - TransferResolver.initiateTransfer → findById (obtem senderPixKey)
    AccountModule,
    OutboxModule,
  ],
  providers: [TransferService, TransferResolver],
  exports: [TransferService],
})
export class TransferModule {}
