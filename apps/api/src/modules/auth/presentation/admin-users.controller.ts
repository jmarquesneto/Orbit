import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '../../../shared/application/ports.js';
import { ReqContext } from '../../../shared/presentation/request-context.js';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import { UsersAdminService } from '../application/users-admin.service.js';
import type { AuthUser } from '../domain/user.js';
import { CurrentUser, Roles } from './decorators.js';

const StatusSchema = z.strictObject({ status: z.enum(['active', 'locked']) });

@Controller('admin/users')
@Roles('admin')
export class AdminUsersController {
  constructor(private readonly users: UsersAdminService) {}

  @Get()
  async list() {
    return { users: await this.users.list() };
  }

  @Patch(':id/status')
  async setStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(StatusSchema)) body: z.infer<typeof StatusSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    return { user: await this.users.setStatus(actor.id, id, body.status, ctx.ip) };
  }
}
