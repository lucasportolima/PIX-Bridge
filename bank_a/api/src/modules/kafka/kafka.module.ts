import { Module } from '@nestjs/common';
import { KafkaProducerService } from './kafka.producer.service';

// KafkaService mantido como alias para retrocompatibilidade
// durante a migração — remover após atualizar todos os imports
export { KafkaProducerService as KafkaService } from './kafka.producer.service';

@Module({
  providers: [KafkaProducerService],
  exports: [KafkaProducerService],
})
export class KafkaModule {}
