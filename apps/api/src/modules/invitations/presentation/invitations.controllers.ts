import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { RequestContext } from '../../../shared/application/ports.js';
import { ReqContext } from '../../../shared/presentation/request-context.js';
import { SiteOrigin } from '../../../shared/presentation/site-origin.js';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import { PasswordInputSchema } from '../../auth/domain/password-policy.js';
import { type AuthUser, PersonNameSchema, ROLES } from '../../auth/domain/user.js';
import { AuthCookies } from '../../auth/presentation/auth-cookies.js';
import { CurrentUser, Public, RequireRecentMfa, Roles } from '../../auth/presentation/decorators.js';
import { InvitationsService } from '../application/invitations.service.js';
import { MAX_TTL_HOURS, MIN_TTL_HOURS } from '../domain/invitation.js';

const CreateInvitationSchema = z.strictObject({
  email: z.email().max(254),
  name: PersonNameSchema.nullable().optional(),
  role: z.enum(ROLES).default('user'),
  ttlHours: z.number().int().min(MIN_TTL_HOURS).max(MAX_TTL_HOURS).optional(),
});

/** O token vai no CORPO (POST), nunca na URL: assim não aparece em logs nem no histórico. */
const TokenSchema = z.strictObject({ token: z.string().max(64) });
const AcceptSchema = z.strictObject({
  token: z.string().max(64),
  name: PersonNameSchema,
  password: PasswordInputSchema,
});

@Controller('admin/invitations')
@Roles('admin')
export class AdminInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @RequireRecentMfa()
  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateInvitationSchema)) body: z.infer<typeof CreateInvitationSchema>,
    @ReqContext() ctx: RequestContext,
    @SiteOrigin() origin: string | null,
  ) {
    return this.invitations.create(actor.id, body, ctx.ip, origin);
  }

  @Get()
  async list() {
    return { invitations: await this.invitations.list() };
  }

  @Delete(':id')
  async revoke(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @ReqContext() ctx: RequestContext,
  ) {
    return { invitation: await this.invitations.revoke(actor.id, id, ctx.ip) };
  }
}

@Controller('invitations')
@Public()
export class PublicInvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly cookies: AuthCookies,
  ) {}

  @Post('inspect')
  @HttpCode(200)
  inspect(
    @Body(new ZodValidationPipe(TokenSchema)) body: z.infer<typeof TokenSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.invitations.inspect(body.token, ctx);
  }

  @Post('accept')
  @HttpCode(201)
  async accept(
    @Body(new ZodValidationPipe(AcceptSchema)) body: z.infer<typeof AcceptSchema>,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, session } = await this.invitations.accept(body.token, { name: body.name, password: body.password }, ctx);
    this.cookies.set(res, session);
    return { user, accessExpiresAt: session.accessExpiresAt };
  }
}
