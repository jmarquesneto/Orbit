import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  type INestApplication,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  Post,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { z } from 'zod';
import { ConfigModule } from '../src/config/config.module.js';
import { SessionService } from '../src/modules/auth/application/session.service.js';
import type { AuthUser } from '../src/modules/auth/domain/user.js';
import { AuthCookies } from '../src/modules/auth/presentation/auth-cookies.js';
import { CurrentUser, Public, Roles } from '../src/modules/auth/presentation/decorators.js';
import { JwtAuthGuard, RolesGuard } from '../src/modules/auth/presentation/guards.js';
import { UnauthenticatedError } from '../src/shared/domain/errors.js';
import { DomainExceptionFilter } from '../src/shared/presentation/domain-exception.filter.js';
import { OriginCheckMiddleware } from '../src/shared/presentation/origin-check.middleware.js';
import { ZodValidationPipe } from '../src/shared/presentation/zod-validation.pipe.js';

const WEB_ORIGIN = 'http://localhost:3000';
const users: Record<string, AuthUser> = {
  'token-admin-aaaaaaaaaaaaa': { id: 'a', email: 'admin@x.com', role: 'admin', sessionId: 's1' },
  'token-user-bbbbbbbbbbbbbb': { id: 'u', email: 'user@x.com', role: 'user', sessionId: 's2' },
};

@Controller()
class ProbeController {
  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return { id: user.id };
  }

  @Roles('admin')
  @Post('admin-only')
  adminOnly(@Body(new ZodValidationPipe(z.strictObject({ name: z.string().max(5) }))) body: { name: string }) {
    return body;
  }

  @Public()
  @Post('public-write')
  publicWrite() {
    return { ok: true };
  }
}

@Module({
  imports: [ConfigModule],
  controllers: [ProbeController],
  providers: [
    AuthCookies,
    {
      provide: SessionService,
      useValue: {
        authenticate: async (token: string) => {
          const user = users[token];
          if (!user) throw new UnauthenticatedError();
          return user;
        },
      },
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OriginCheckMiddleware).forRoutes('*path');
  }
}

describe('Segurança HTTP (guards, CSRF, validação)', () => {
  let app: INestApplication;
  const rand = () => randomBytes(32).toString('base64url');

  beforeAll(async () => {
    Object.assign(process.env, {
      WEB_ORIGIN,
      DB_HOST: 'db',
      DB_NAME: 'x',
      DB_APP_USER: 'x',
      DB_APP_PASSWORD: rand(),
      REDIS_HOST: 'redis',
      REDIS_PASSWORD: rand(),
      JWT_ACCESS_SECRET: rand(),
      JWT_REFRESH_SECRET: rand(),
      SESSION_SECRET: rand(),
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    });
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  it('rota pública responde sem login', () => http().get('/open').expect(200));

  it('rota protegida sem token → 401 com corpo padronizado', async () => {
    const res = await http().get('/mine').expect(401);
    expect(res.body).toEqual({
      error: { code: 'unauthenticated', message: expect.any(String) },
    });
  });

  it('aceita o token pelo cookie httpOnly ou pelo header Bearer', async () => {
    await http().get('/mine').set('Cookie', 'access_token=token-user-bbbbbbbbbbbbbb').expect(200, { id: 'u' });
    await http().get('/mine').set('Authorization', 'Bearer token-user-bbbbbbbbbbbbbb').expect(200);
  });

  it('usuário comum em rota de admin → 403', () =>
    http()
      .post('/admin-only')
      .set('Authorization', 'Bearer token-user-bbbbbbbbbbbbbb')
      .send({ name: 'ok' })
      .expect(403));

  it('admin passa e o corpo é validado (campo extra → 400)', async () => {
    const auth = { Authorization: 'Bearer token-admin-aaaaaaaaaaaaa' };
    await http().post('/admin-only').set(auth).send({ name: 'ok' }).expect(201, { name: 'ok' });
    const res = await http().post('/admin-only').set(auth).send({ name: 'ok', role: 'admin' }).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('CSRF: POST com Origin de outro site → 403', () =>
    http().post('/public-write').set('Origin', 'https://site-malicioso.com').expect(403));

  it('CSRF: POST com cookie e sem Origin/Referer → 403', () =>
    http().post('/public-write').set('Cookie', 'access_token=qualquer').expect(403));

  it('POST da própria origem passa; cliente sem cookie e sem Origin também', async () => {
    await http().post('/public-write').set('Origin', WEB_ORIGIN).expect(201);
    await http().post('/public-write').expect(201);
  });
});
