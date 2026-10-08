import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.schema.js';
import { configureApp } from './configure-app.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Desligado para registrar o parser JSON com limite de tamanho explícito (configureApp).
    bodyParser: false,
  });
  const env = app.get<Env>(ENV);
  configureApp(app, env);
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, '0.0.0.0');
  Logger.log(`API ouvindo na porta ${env.API_PORT}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  Logger.error(err instanceof Error ? err.message : err, 'Bootstrap');
  process.exit(1);
});
