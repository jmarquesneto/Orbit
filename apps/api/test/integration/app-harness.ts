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
import { USER_REPOSITORY, type UserRepository } from '../../src/modules/auth/application/ports.js';
import { applyTestEnv } from './test-env.js';

export interface TestUser {
  id: string;
  email: string;
  token: string;
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

  /** Cria um usuário comum direto no banco e devolve um access token válido para ele. */
  async function newUser(label = 'user'): Promise<TestUser> {
    const email = `${label}-${randomUUID()}@teste.local`;
    const user = await db.run(() =>
      users.create({ email, passwordHash: 'x', role: 'user', at: new Date() }),
    );
    const session = await db.run(() => sessions.issue(user, { ip: '127.0.0.1', userAgent: 'vitest' }));
    return { id: user.id, email, token: session.accessToken };
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
    };
  }

  return { app, db, newUser, as, close: () => app.close() };
}

export type Harness = Awaited<ReturnType<typeof startApp>>;
