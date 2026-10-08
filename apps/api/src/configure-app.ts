import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env.schema.js';

/** Configuração HTTP compartilhada entre o servidor real (main.ts) e os testes de integração. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  // O navegador fala com o frontend, que repassa /api/* para cá pela rede interna do Docker.
  app.setGlobalPrefix('api');
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      // A API só devolve JSON: nada pode ser renderizado, embutido ou executado.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '100kb' });
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
}
