import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '../../../shared/application/ports.js';
import { ReqContext } from '../../../shared/presentation/request-context.js';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import type { AuthUser } from '../../auth/domain/user.js';
import { CurrentUser } from '../../auth/presentation/decorators.js';
import { SharingService } from '../application/sharing.service.js';
import { RESOURCE_TYPES, SHARE_ROLE_CODES } from '../domain/permissions.js';

const ResourceQuery = z.strictObject({
  resourceType: z.enum(RESOURCE_TYPES),
  resourceId: z.uuid(),
});

const ShareSchema = z.strictObject({
  resourceType: z.enum(RESOURCE_TYPES),
  resourceId: z.uuid(),
  email: z.email().max(254),
  role: z.enum(SHARE_ROLE_CODES),
  expiresAt: z.coerce.date().optional(),
});

@Controller()
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Get('share-roles')
  async roles() {
    return { roles: await this.sharing.listRoles() };
  }

  @Get('shares')
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ResourceQuery)) q: z.infer<typeof ResourceQuery>,
  ) {
    return { shares: await this.sharing.list(user.id, q.resourceType, q.resourceId) };
  }

  @Post('shares')
  async share(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ShareSchema)) body: z.infer<typeof ShareSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    const share = await this.sharing.share(
      user.id,
      { type: body.resourceType, resourceId: body.resourceId, email: body.email, role: body.role, expiresAt: body.expiresAt },
      ctx.ip,
    );
    return { share };
  }

  @Delete('shares/:id')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ReqContext() ctx: RequestContext,
  ) {
    await this.sharing.revoke(user.id, id, ctx.ip);
  }
}
