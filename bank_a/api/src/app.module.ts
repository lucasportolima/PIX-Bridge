import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { LoggerModule } from 'nestjs-pino';

import { AppConfigModule } from './config/config.module';
import { buildPinoOptions } from './config/logger.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AccountModule } from './modules/account/account.module';
import { AuthModule } from './modules/auth/auth.module';
import { TransferModule } from './modules/transfer/transfer.module';
import { AiModule } from './modules/ai/ai.module';
import { KafkaModule } from './modules/kafka/kafka.module';
import { OutboxModule } from './modules/outbox/outbox.module';

@Module({
  imports: [
    // ─── Config (global) ─────────────────────────────────────────────────────
    // AppConfigModule is @Global() — TypedConfigService is injectable everywhere
    AppConfigModule,

    // ─── Logger ──────────────────────────────────────────────────────────────
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get<string>('NODE_ENV') !== 'production';
        return buildPinoOptions(isDev);
      },
    }),

    // ─── MongoDB ─────────────────────────────────────────────────────────────
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
        retryWrites: true,
        writeConcern: { w: 'majority', journal: true },
      }),
    }),

    // ─── GraphQL ─────────────────────────────────────────────────────────────
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      subscriptions: {
        'graphql-ws': true,
      },
      context: ({ req }: { req: Request }) => ({ req }),
    }),

    // ─── Domain modules ──────────────────────────────────────────────────────
    AccountModule,
    AuthModule,
    TransferModule,
    AiModule,
    KafkaModule,
    OutboxModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
