import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { RequestContext } from '../../../shared/application/ports.js';
import { ReqContext } from '../../../shared/presentation/request-context.js';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import { SetupService } from '../application/setup.service.js';
import { PasswordInputSchema } from '../domain/password-policy.js';
import { PersonNameSchema } from '../domain/user.js';
import { AuthCookies } from './auth-cookies.js';
import { Public } from './decorators.js';

const SetupSchema = z.strictObject({
  name: PersonNameSchema,
  email: z.email().max(254),
  password: PasswordInputSchema,
});

/** Primeiro acesso: criar a conta de administrador (só enquanto não há nenhuma conta). */
@Controller('setup')
@Public()
export class SetupController {
  constructor(
    private readonly setup: SetupService,
    private readonly cookies: AuthCookies,
  ) {}

  @Get()
  async status() {
    return { needed: await this.setup.isNeeded() };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(SetupSchema)) body: z.infer<typeof SetupSchema>,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, session } = await this.setup.createFirstAdmin(body, ctx);
    this.cookies.set(res, session);
    return { user, accessExpiresAt: session.accessExpiresAt };
  }
}
