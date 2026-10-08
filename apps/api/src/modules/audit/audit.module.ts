import { Global, Module } from '@nestjs/common';
import { AUDIT_LOG } from '../../shared/application/ports.js';
import { DrizzleAuditLog } from './infrastructure/drizzle-audit-log.js';

@Global()
@Module({
  providers: [{ provide: AUDIT_LOG, useClass: DrizzleAuditLog }],
  exports: [AUDIT_LOG],
})
export class AuditModule {}
