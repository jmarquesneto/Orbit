import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CheckReadinessUseCase } from '../src/modules/health/application/check-readiness.use-case.js';
import { HealthController } from '../src/modules/health/presentation/health.controller.js';

describe('HealthController (http)', () => {
  let app: INestApplication;
  const execute = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: CheckReadinessUseCase, useValue: { execute } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /health/live → 200', () =>
    request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' }));

  it('GET /health/ready → 200 quando tudo está de pé', async () => {
    execute.mockResolvedValueOnce({ status: 'ok', dependencies: { database: 'up' } });
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });

  it('GET /health/ready → 503 quando uma dependência cai', async () => {
    execute.mockResolvedValueOnce({ status: 'error', dependencies: { database: 'down' } });
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(res.body.dependencies).toEqual({ database: 'down' });
  });
});
