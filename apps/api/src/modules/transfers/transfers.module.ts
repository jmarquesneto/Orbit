import { Module } from '@nestjs/common';
import { WalletsModule } from '../wallets/wallets.module.js';
import { TRANSFER_REPOSITORY } from './application/ports.js';
import { TransfersService } from './application/transfers.service.js';
import { DrizzleTransferRepository } from './infrastructure/drizzle-transfer.repository.js';
import { TransfersController } from './presentation/transfers.controller.js';

/** Transferências entre carteiras do próprio usuário. */
@Module({
  imports: [WalletsModule],
  controllers: [TransfersController],
  providers: [{ provide: TRANSFER_REPOSITORY, useClass: DrizzleTransferRepository }, TransfersService],
})
export class TransfersModule {}
