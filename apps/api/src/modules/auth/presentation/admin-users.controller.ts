import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '../../../shared/application/ports.js';
import { ReqContext } from '../../../shared/presentation/request-context.js';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import { MfaService } from '../application/mfa.service.js';
import { UsersAdminService } from '../application/users-admin.service.js';
import type { AuthUser } from '../domain/user.js';
import { CurrentUser, RequireRecentMfa, Roles } from './decorators.js';

const StatusSchema = z.strictObject({ status: z.enum(['active', 'locked']) });

@Controller('admin/users')
@Roles('admin')
export class AdminUsersController {
  constructor(
    private readonly users: UsersAdminService,
    private readonly mfa: MfaService,
  ) {}

  @Get()
  async list() {
    return { users: await this.users.list() };
  }

  @RequireRecentMfa()
  @Patch(':id/status')
  async setStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(StatusSchema)) body: z.infer<typeof StatusSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    return { user: await this.users.setStatus(actor.id, id, body.status, ctx.ip) };
  }

  /** Senha provisória (mostrada uma vez) para quem esqueceu a senha. */
  @RequireRecentMfa()
  @Post(':id/password/reset')
  @HttpCode(200)
  resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.users.resetPassword(actor.id, id, ctx.ip);
  }

  /** Para quem perdeu o celular: desativa o MFA e encerra as sessões da pessoa. */
  @RequireRecentMfa()
  @Post(':id/mfa/reset')
  @HttpCode(200)
  async resetMfa(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @ReqContext() ctx: RequestContext,
  ) {
    return { user: await this.mfa.adminReset(actor.id, id, ctx.ip) };
  }
}
