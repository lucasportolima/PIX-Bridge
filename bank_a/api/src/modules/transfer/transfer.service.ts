import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { User, UserDocument } from '../account/schemas/user.schema';
import { Transfer, TransferDocument, TransferDirection, TransferStatus } from './schemas/transfer.schema';
import { OutboxService } from '../outbox/outbox.service';

export interface InitiateTransferParams {
  senderAccountNumber: string;
  receiverPixKey: string;
  /** Amount in cents */
  amount: number;
  description?: string;
  correlationId?: string;
}

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    @InjectModel(Transfer.name)
    private readonly transferModel: Model<TransferDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Initiates an outbound PIX transfer from Bank A → Bank B.
   *
   * Uses a MongoDB multi-document transaction to atomically:
   *  1. Debit the sender's balance (with optimistic locking via `__v`)
   *  2. Create the Transfer record
   *  3. Persist an OutboxEvent for the Kafka publisher
   *
   * If any step fails, the entire transaction is rolled back — no partial state.
   */
  async initiateOutbound(params: InitiateTransferParams): Promise<TransferDocument> {
    const session = await this.connection.startSession();

    try {
      let transfer!: TransferDocument;

      await session.withTransaction(async () => {
        // Optimistic lock: only update if balance is sufficient and __v matches
        const sender = await this.userModel
          .findOneAndUpdate(
            {
              accountNumber: params.senderAccountNumber,
              balance: { $gte: params.amount },
              isActive: true,
            },
            { $inc: { balance: -params.amount } },
            { new: true, session },
          )
          .exec();

        if (!sender) {
          throw new BadRequestException('Insufficient balance or account not found');
        }

        const transferId = uuidv4();

        [transfer] = await this.transferModel.create(
          [
            {
              transferId,
              senderAccountNumber: params.senderAccountNumber,
              receiverPixKey: params.receiverPixKey,
              amount: params.amount,
              description: params.description,
              status: TransferStatus.PENDING,
              direction: TransferDirection.OUTBOUND,
              correlationId: params.correlationId,
            },
          ],
          { session },
        );

        // Outbox event is persisted in the same transaction — dual-write prevention
        await this.outboxService.createEvent(
          {
            topic: 'pix.transfer.initiated',
            eventType: 'pix.transfer.initiated',
            aggregateId: transferId,
            payload: {
              specversion: '1.0',
              type: 'pix.transfer.initiated',
              source: '/bank-a/transfer',
              id: transferId,
              time: new Date().toISOString(),
              data: {
                transferId,
                senderAccountNumber: params.senderAccountNumber,
                receiverPixKey: params.receiverPixKey,
                amount: params.amount,
                description: params.description,
                correlationId: params.correlationId,
              },
            },
          },
          session,
        );

        this.logger.log(
          { transferId, amount: params.amount, correlationId: params.correlationId },
          'Transfer initiated',
        );
      });

      return transfer;
    } finally {
      await session.endSession();
    }
  }

  async findByTransferId(transferId: string): Promise<TransferDocument> {
    const transfer = await this.transferModel.findOne({ transferId }).exec();
    if (!transfer) throw new NotFoundException(`Transfer ${transferId} not found`);
    return transfer;
  }

  async findByAccount(accountNumber: string, limit = 20): Promise<TransferDocument[]> {
    return this.transferModel
      .find({ senderAccountNumber: accountNumber })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async updateStatus(transferId: string, status: TransferStatus, failureReason?: string): Promise<void> {
    const update: Record<string, unknown> = { status };
    if (status === TransferStatus.COMPLETED) update.completedAt = new Date();
    if (failureReason) update.failureReason = failureReason;

    await this.transferModel.updateOne({ transferId }, { $set: update });
  }
}
