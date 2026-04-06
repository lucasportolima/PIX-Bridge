import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Replace NestJS default logger with Pino so every internal NestJS log
  // (module init, route registration, errors) is also structured JSON
  app.useLogger(app.get(Logger));

  // Global validation pipe — strips unknown fields and validates DTOs automatically
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({ origin: process.env.CORS_ORIGIN ?? '*' });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  app.get(Logger).log(`Bank A API running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap', err);
  process.exit(1);
});
