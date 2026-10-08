import { Body, Controller, Get, Header, Param, Patch, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { RequestContext } from '../../../shared/application/ports.js';
import { ReqContext } from '../../../shared/presentation/request-context.js';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import type { AuthUser } from '../../auth/domain/user.js';
import { CurrentUser, Public, RequireRecentMfa, Roles } from '../../auth/presentation/decorators.js';
import { BrandingEventsService } from '../application/branding-events.service.js';
import { SettingsService } from '../application/settings.service.js';

const HEARTBEAT_MS = 25_000;
const MAX_STREAMS = 500;

/** Identidade pública: usada pelo frontend em todas as telas, inclusive antes do login. */
@Controller('branding')
export class BrandingController {
  private streams = 0;

  constructor(
    private readonly settings: SettingsService,
    private readonly events: BrandingEventsService,
  ) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  get() {
    return this.settings.getBranding();
  }

  /**
   * Server-Sent Events: as abas abertas recebem o novo nome/cor/logo assim que o admin
   * salva, sem recarregar. Só dados públicos trafegam aqui (os mesmos de GET /branding).
   */
  @Public()
  @Get('events')
  async stream(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (this.streams >= MAX_STREAMS) {
      res.status(503).setHeader('Retry-After', '30').json({ error: { code: 'busy', message: 'Tente mais tarde.' } });
      return;
    }
    this.streams++;
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (branding: unknown) => res.write(`event: branding\ndata: ${JSON.stringify(branding)}\n\n`);
    // reconexão do navegador em 5 s se cair; e o estado atual logo de cara
    res.write('retry: 5000\n\n');
    send(await this.settings.getBranding());

    const unsubscribe = this.events.subscribe(send);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      this.streams--;
    });
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
