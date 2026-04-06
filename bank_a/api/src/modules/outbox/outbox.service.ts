import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { OutboxEvent, OutboxEventDocument, OutboxStatus } from './schemas/outbox-event.schema';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectModel(OutboxEvent.name)
    private readonly outboxModel: Model<OutboxEventDocument>,
  ) {}

  /**
   * Persists an outbox event within an existing Mongoose session (transaction).
   * Must be called inside a session started by the Transfer service to guarantee
   * atomicity between the balance debit and the event creation.
   */
  async createEvent(
    params: {
      topic: string;
      eventType: string;
      aggregateId: string;
      payload: Record<string, unknown>;
    },
    session: ClientSession,
  ): Promise<OutboxEventDocument> {
    const [event] = await this.outboxModel.create([params], { session });
    this.logger.debug({ aggregateId: params.aggregateId, topic: params.topic }, 'Outbox event created');
    return event;
  }

  /**
   * Retrieves pending events ordered by creation date (FIFO).
   * Called by the OutboxPublisher worker on each polling cycle.
   */
  async findPending(limit = 50): Promise<OutboxEventDocument[]> {
    return this.outboxModel.find({ status: OutboxStatus.PENDING }).sort({ createdAt: 1 }).limit(limit).exec();
  }

  async markPublished(id: string): Promise<void> {
    await this.outboxModel.updateOne(
      { _id: id },
      { $set: { status: OutboxStatus.PUBLISHED, publishedAt: new Date() } },
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.outboxModel.updateOne(
      { _id: id },
      { $inc: { retryCount: 1 }, $set: { status: OutboxStatus.FAILED, lastError: error } },
    );
  }
}
