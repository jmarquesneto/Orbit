import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { ENV } from '../../src/config/config.module.js';
import type { Env } from '../../src/config/env.schema.js';
import { configureApp } from '../../src/configure-app.js';
import { DbContext } from '../../src/infrastructure/database/db-context.js';
import { SessionService } from '../../src/modules/auth/application/session.service.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
  SECRET_CIPHER,
  type SecretCipher,
  USER_REPOSITORY,
  type UserRepository,
} from '../../src/modules/auth/application/ports.js';
import { generateTotpSecret } from '../../src/modules/auth/domain/totp.js';
import { applyTestEnv } from './test-env.js';

export interface TestUser {
  id: string;
  email: string;
  token: string;
  sessionId: string;
  /** Segredo TOTP do "app autenticador" deste usuário (null se criado sem MFA). */
  mfaSecret: Buffer | null;
}

export async function startApp() {
  applyTestEnv();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app, app.get<Env>(ENV));
  await app.init();

  const db = app.get(DbContext);
  const users = app.get<UserRepository>(USER_REPOSITORY);
  const sessions = app.get(SessionService);
  const cipher = app.get<SecretCipher>(SECRET_CIPHER);
  const hasher = app.get<PasswordHasher>(PASSWORD_HASHER);

  /**
   * Cria um usuário direto no banco e devolve um access token válido para ele.
   * Por padrão já com MFA ativo e confirmado agora, como alguém que acabou de entrar.
   */
  async function newUser(
    label = 'user',
    opts: { mfa?: boolean; password?: string; role?: 'user' | 'admin' } = {},
  ): Promise<TestUser> {
    const email = `${label}-${randomUUID()}@teste.local`;
    const mfaSecret = opts.mfa === false ? null : generateTotpSecret();
    const passwordHash = opts.password ? await hasher.hash(opts.password) : 'x';
    const user = await db.run(async () => {
      const created = await users.create({ email, passwordHash, role: opts.role ?? 'user', at: new Date() });
      if (mfaSecret) await users.setMfa(created.id, { enabled: true, secret: cipher.encrypt(mfaSecret), lastStep: null });
      return created;
    });
    const session = await db.run(() =>
      sessions.issue(user, { ip: '127.0.0.1', userAgent: 'vitest' }, { mfaVerifiedAt: mfaSecret ? new Date() : null }),
    );
    return { id: user.id, email, token: session.accessToken, sessionId: session.sessionId, mfaSecret };
  }

  /** Cliente HTTP autenticado como `user` (Bearer: sem cookie, então sem exigência de Origin). */
  function as(user: TestUser) {
    const auth = { Authorization: `Bearer ${user.token}` };
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(`/api${url}`).set(auth),
      post: (url: string, body?: object) => request(server).post(`/api${url}`).set(auth).send(body ?? {}),
      patch: (url: string, body: object) => request(server).patch(`/api${url}`).set(auth).send(body),
      delete: (url: string) => request(server).delete(`/api${url}`).set(auth),
      upload: (url: string, file: { name: string; bytes: Buffer }, fields: Record<string, string> = {}) => {
        let req = request(server).post(`/api${url}`).set(auth).attach('file', file.bytes, file.name);
        for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
        return req;
      },
    };
  }

  return { app, db, newUser, as, close: () => app.close() };
}

export type Harness = Awaited<ReturnType<typeof startApp>>;
