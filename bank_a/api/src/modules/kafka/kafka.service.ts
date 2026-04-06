import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Producer, RecordMetadata, Partitioners } from 'kafkajs';
import { TypedConfigService } from '../../config';

export interface KafkaMessage {
  key?: string;
  value: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Thin wrapper around KafkaJS Producer with lazy connection.
 * The producer connects on first publish rather than at module init —
 * this prevents the app from failing to start if Kafka is momentarily unavailable.
 */
@Injectable()
export class KafkaService implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly producer: Producer;
  private connected = false;

  constructor(private readonly config: TypedConfigService) {
    const brokers = this.config.get('KAFKA_BROKERS').split(',');
    const clientId = this.config.get('KAFKA_CLIENT_ID');

    const kafka = new Kafka({
      clientId,
      brokers,
      retry: { retries: 5, initialRetryTime: 300 },
    });

    this.producer = kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
      allowAutoTopicCreation: false,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) {
      await this.producer.disconnect();
      this.logger.log('Kafka producer disconnected');
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.producer.connect();
    this.connected = true;
    this.logger.log('Kafka producer connected');
  }

  /**
   * Publishes a message to a Kafka topic.
   * Connects lazily on first call.
   */
  async publish(topic: string, message: KafkaMessage): Promise<RecordMetadata[]> {
    await this.ensureConnected();

    const result = await this.producer.send({
      topic,
      messages: [
        {
          key: message.key,
          value: JSON.stringify(message.value),
          headers: message.headers,
        },
      ],
    });

    this.logger.debug({ topic, key: message.key }, 'Message published to Kafka');
    return result;
  }
}
