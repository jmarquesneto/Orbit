import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccessControlService } from './application/access-control.service.js';
import { SHARING_REPOSITORY } from './application/ports.js';
import { SharingService } from './application/sharing.service.js';
import { DrizzleSharingRepository } from './infrastructure/drizzle-sharing.repository.js';
import { SharingController } from './presentation/sharing.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [SharingController],
  providers: [
    { provide: SHARING_REPOSITORY, useClass: DrizzleSharingRepository },
    AccessControlService,
    SharingService,
  ],
  exports: [AccessControlService],
})
export class SharingModule {}
