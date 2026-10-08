import { Module } from '@nestjs/common';
import { INVOICE_REPOSITORY, WALLET_REPOSITORY } from './application/ports.js';
import { WalletsService } from './application/wallets.service.js';
import { DrizzleInvoiceRepository } from './infrastructure/drizzle-invoice.repository.js';
import { DrizzleWalletRepository } from './infrastructure/drizzle-wallet.repository.js';
import { WalletsController } from './presentation/wallets.controller.js';

@Module({
  controllers: [WalletsController],
  providers: [
    { provide: WALLET_REPOSITORY, useClass: DrizzleWalletRepository },
    { provide: INVOICE_REPOSITORY, useClass: DrizzleInvoiceRepository },
    WalletsService,
  ],
  exports: [WalletsService, INVOICE_REPOSITORY],
})
export class WalletsModule {}
