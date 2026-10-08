import { Module } from '@nestjs/common';
import { BrandingEventsService } from './application/branding-events.service.js';
import { BRANDING_BROADCASTER, BRANDING_CACHE, SETTINGS_REPOSITORY } from './application/ports.js';
import { SettingsService } from './application/settings.service.js';
import { DrizzleSettingsRepository } from './infrastructure/drizzle-settings.repository.js';
import { RedisBrandingBroadcaster } from './infrastructure/redis-branding.broadcaster.js';
import { RedisBrandingCache } from './infrastructure/redis-branding.cache.js';
import { AdminSettingsController, BrandingController } from './presentation/settings.controllers.js';

@Module({
  controllers: [BrandingController, AdminSettingsController],
  providers: [
    { provide: SETTINGS_REPOSITORY, useClass: DrizzleSettingsRepository },
    { provide: BRANDING_CACHE, useClass: RedisBrandingCache },
    { provide: BRANDING_BROADCASTER, useClass: RedisBrandingBroadcaster },
    SettingsService,
    BrandingEventsService,
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
