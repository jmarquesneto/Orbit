import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { RequestContext } from '../../../shared/application/ports.js';
import { ReqContext } from '../../../shared/presentation/request-context.js';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import { AccountService } from '../application/account.service.js';
import { LoginUseCase } from '../application/login.use-case.js';
import { MfaService } from '../application/mfa.service.js';
import { SessionService } from '../application/session.service.js';
import { PasswordInputSchema } from '../domain/password-policy.js';
import { type AuthUser, PersonNameSchema } from '../domain/user.js';
import { AuthCookies } from './auth-cookies.js';
import { AllowDuringSetup, CurrentUser, Public } from './decorators.js';

const MfaVerifySchema = z.strictObject({
  challenge: z.string().max(128),
  code: z.string().trim().min(6).max(32),
});

const ProfileSchema = z.strictObject({ name: PersonNameSchema });
const ChangePasswordSchema = z.strictObject({
  currentPassword: PasswordInputSchema,
  newPassword: PasswordInputSchema,
});

const LoginSchema = z.strictObject({
  email: z.string().trim().max(254),
  password: PasswordInputSchema,
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly login: LoginUseCase,
    private readonly sessions: SessionService,
    private readonly cookies: AuthCookies,
    private readonly mfa: MfaService,
    private readonly account: AccountService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async signIn(
    @Body(new ZodValidationPipe(LoginSchema)) body: z.infer<typeof LoginSchema>,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.login.execute(body, ctx);
    if (result.kind === 'mfa') return { mfaRequired: true, challenge: result.challenge };
    this.cookies.set(res, result.session);
    return { user: result.user, accessExpiresAt: result.session.accessExpiresAt };
  }

  /** Segunda etapa do login: troca o desafio + código (TOTP ou recuperação) pela sessão. */
  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(
    @Body(new ZodValidationPipe(MfaVerifySchema)) body: z.infer<typeof MfaVerifySchema>,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, session } = await this.mfa.completeLogin(body.challenge, body.code, ctx);
    this.cookies.set(res, session);
    return { user, accessExpiresAt: session.accessExpiresAt };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const session = await this.sessions.rotate(this.cookies.refreshTokenFrom(req), ctx);
      this.cookies.set(res, session);
      return { accessExpiresAt: session.accessExpiresAt };
    } catch (err) {
      this.cookies.clear(res);
      throw err;
    }
  }

  @AllowDuringSetup()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.sessions.end(user.sessionId);
    this.cookies.clear(res);
  }

  @AllowDuringSetup()
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      mfaEnabled: user.mfaEnabled,
      mfaRequired: await this.mfa.isRequired(),
    };
  }

  /** Nome de exibição da própria conta. */
  @AllowDuringSetup()
  @Patch('me')
  async updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ProfileSchema)) body: z.infer<typeof ProfileSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    return { user: await this.account.updateName(user, body.name, ctx.ip) };
  }

  /** Troca a própria senha (também usada para sair da senha provisória do admin). */
  @AllowDuringSetup()
  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ChangePasswordSchema)) body: z.infer<typeof ChangePasswordSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    await this.account.changePassword(user, body, ctx);
  }
}
