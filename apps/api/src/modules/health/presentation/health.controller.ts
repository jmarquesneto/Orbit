import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { CheckReadinessUseCase } from '../application/check-readiness.use-case.js';
import type { ReadinessReport } from '../domain/dependency-probe.js';

@Controller('health')
export class HealthController {
  constructor(private readonly checkReadiness: CheckReadinessUseCase) {}

  /** Liveness: o processo está de pé. Usado pelo healthcheck do Docker. */
  @Get('live')
  @HttpCode(200)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: banco e cache respondem. */
  @Get('ready')
  async ready(): Promise<ReadinessReport> {
    const report = await this.checkReadiness.execute();
    if (report.status !== 'ok') throw new ServiceUnavailableException(report);
    return report;
  }
}
