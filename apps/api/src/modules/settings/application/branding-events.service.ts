import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Branding } from '../domain/setting-definitions.js';
import { BRANDING_BROADCASTER, type BrandingBroadcaster } from './ports.js';
import { SettingsService } from './settings.service.js';

const BRANDING_KEYS = new Set(['app.name', 'app.accent', 'app.logo_url']);

/** Liga "configuração salva" a "abas abertas atualizadas" sem acoplar o SettingsService ao Redis. */
@Injectable()
export class BrandingEventsService implements OnModuleInit {
  constructor(
    private readonly settings: SettingsService,
    @Inject(BRANDING_BROADCASTER) private readonly broadcaster: BrandingBroadcaster,
  ) {}

  onModuleInit(): void {
    this.settings.onChange(async (key) => {
      if (BRANDING_KEYS.has(key)) await this.broadcaster.publish(await this.settings.getBranding());
    });
  }

  subscribe(listener: (branding: Branding) => void): () => void {
    return this.broadcaster.subscribe(listener);
  }
}
