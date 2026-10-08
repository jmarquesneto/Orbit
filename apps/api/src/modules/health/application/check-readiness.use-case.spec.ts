import type { DependencyProbe } from '../domain/dependency-probe.js';
import { CheckReadinessUseCase } from './check-readiness.use-case.js';

const probe = (name: string, check: () => Promise<void>): DependencyProbe => ({ name, check });

describe('CheckReadinessUseCase', () => {
  it('reporta ok quando todas as dependências respondem', async () => {
    const useCase = new CheckReadinessUseCase([
      probe('database', async () => undefined),
      probe('cache', async () => undefined),
    ]);
    await expect(useCase.execute()).resolves.toEqual({
      status: 'ok',
      dependencies: { database: 'up', cache: 'up' },
    });
  });

  it('reporta erro e marca só a dependência que falhou', async () => {
    const useCase = new CheckReadinessUseCase([
      probe('database', async () => {
        throw new Error('password authentication failed for user "x"');
      }),
      probe('cache', async () => undefined),
    ]);
    const report = await useCase.execute();
    expect(report).toEqual({ status: 'error', dependencies: { database: 'down', cache: 'up' } });
    expect(JSON.stringify(report)).not.toContain('password');
  });

  it('marca como down uma dependência que não responde a tempo', async () => {
    vi.useFakeTimers();
    const useCase = new CheckReadinessUseCase([probe('cache', () => new Promise(() => undefined))]);
    const pending = useCase.execute();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toEqual({ status: 'error', dependencies: { cache: 'down' } });
    vi.useRealTimers();
  });
});
