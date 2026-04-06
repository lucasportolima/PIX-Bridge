import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.config';
import { TypedConfigService } from './typed-config.service';

/**
 * @Global() ensures TypedConfigService is injectable in every module
 * without each module having to import this module explicitly.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // Explicit path prevents issues when cwd differs from project root
      envFilePath: ['.env', '.env.local'],
    }),
  ],
  providers: [TypedConfigService],
  exports: [TypedConfigService],
})
export class AppConfigModule {}
