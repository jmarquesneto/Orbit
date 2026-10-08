import { Module } from '@nestjs/common';
import { BRANDING_CACHE, SETTINGS_REPOSITORY } from './application/ports.js';
import { SettingsService } from './application/settings.service.js';
import { DrizzleSettingsRepository } from './infrastructure/drizzle-settings.repository.js';
import { RedisBrandingCache } from './infrastructure/redis-branding.cache.js';
import { AdminSettingsController, BrandingController } from './presentation/settings.controllers.js';

@Module({
  controllers: [BrandingController, AdminSettingsController],
  providers: [
    { provide: SETTINGS_REPOSITORY, useClass: DrizzleSettingsRepository },
    { provide: BRANDING_CACHE, useClass: RedisBrandingCache },
    SettingsService,
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
