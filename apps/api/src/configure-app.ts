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
      crossOriginEmbedderPolicy: { policy: 'require-corp' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      // HSTS só em HTTPS: quem decide é o frontend (middleware) ou o proxy com TLS. A API
      // fica na rede interna e as respostas dela passariam também por HTTP.
      strictTransportSecurity: false,
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '100kb' });
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
}
