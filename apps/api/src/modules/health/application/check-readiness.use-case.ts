import { Inject, Injectable } from '@nestjs/common';
import {
  DEPENDENCY_PROBES,
  type DependencyProbe,
  type ReadinessReport,
} from '../domain/dependency-probe.js';

const PROBE_TIMEOUT_MS = 2_000;

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class CheckReadinessUseCase {
  constructor(@Inject(DEPENDENCY_PROBES) private readonly probes: DependencyProbe[]) {}

  /** Nunca expõe a mensagem de erro da dependência: só up/down. */
  async execute(): Promise<ReadinessReport> {
    const results = await Promise.allSettled(
      this.probes.map((p) => withTimeout(p.check(), PROBE_TIMEOUT_MS)),
    );
    const dependencies = Object.fromEntries(
      this.probes.map((p, i) => [p.name, results[i]?.status === 'fulfilled' ? 'up' : 'down']),
    ) as ReadinessReport['dependencies'];
    const status = Object.values(dependencies).every((s) => s === 'up') ? 'ok' : 'error';
    return { status, dependencies };
  }
}
