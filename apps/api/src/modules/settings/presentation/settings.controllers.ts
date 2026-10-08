import { Body, Controller, Get, Header, Param, Patch } from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '../../../shared/application/ports.js';
import { ReqContext } from '../../../shared/presentation/request-context.js';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import type { AuthUser } from '../../auth/domain/user.js';
import { CurrentUser, Public, RequireRecentMfa, Roles } from '../../auth/presentation/decorators.js';
import { SettingsService } from '../application/settings.service.js';

/** Identidade pública: usada pelo frontend em todas as telas, inclusive antes do login. */
@Controller('branding')
export class BrandingController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  get() {
    return this.settings.getBranding();
  }
}

const UpdateSettingSchema = z.strictObject({
  value: z.unknown(),
  reason: z.string().trim().max(200).optional(),
});

const settingKeyPipe = new ZodValidationPipe(
  z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/).max(64),
);

@Controller('admin/settings')
@Roles('admin')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async list() {
    return { settings: await this.settings.list() };
  }

  /** Ex.: PATCH /api/admin/settings/app.name  { "value": "Meu Sistema" } */
  @RequireRecentMfa()
  @Patch(':key')
  async update(
    @CurrentUser() actor: AuthUser,
    @Param('key', settingKeyPipe) key: string,
    @Body(new ZodValidationPipe(UpdateSettingSchema)) body: z.infer<typeof UpdateSettingSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    return {
      setting: await this.settings.update(actor.id, key, body.value, {
        ip: ctx.ip,
        reason: body.reason ?? null,
      }),
    };
  }
}
