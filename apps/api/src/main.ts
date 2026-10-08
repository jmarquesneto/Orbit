import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Desligado para registrar abaixo o parser JSON com limite de tamanho explícito.
    bodyParser: false,
  });
  const env = app.get<Env>(ENV);

  // A API só é alcançada pelo frontend via rede interna do Docker (proxy reverso).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.useBodyParser('json', { limit: '100kb' });
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, '0.0.0.0');
  Logger.log(`API ouvindo na porta ${env.API_PORT}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  Logger.error(err instanceof Error ? err.message : err, 'Bootstrap');
  process.exit(1);
});
