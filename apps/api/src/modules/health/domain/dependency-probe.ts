/** Porta (Clean Architecture): qualquer dependência externa que precise estar de pé. */
export interface DependencyProbe {
  readonly name: string;
  /** Resolve se a dependência responde; rejeita caso contrário. */
  check(): Promise<void>;
}

export const DEPENDENCY_PROBES = Symbol('DEPENDENCY_PROBES');

export type DependencyStatus = 'up' | 'down';

export interface ReadinessReport {
  status: 'ok' | 'error';
  dependencies: Record<string, DependencyStatus>;
}
