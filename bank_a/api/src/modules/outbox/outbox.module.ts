import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OutboxEvent, OutboxEventSchema } from './schemas/outbox-event.schema';
import { OutboxService } from './outbox.service';
import { OutboxWorkerService } from './outbox-worker.service';
import { KafkaModule } from '../kafka/kafka.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: OutboxEvent.name, schema: OutboxEventSchema }]),
    // KafkaModule exporta KafkaProducerService, injetado pelo OutboxWorkerService
    KafkaModule,
  ],
  providers: [OutboxService, OutboxWorkerService],
  exports: [OutboxService],
})
export class OutboxModule {}
