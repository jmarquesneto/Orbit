import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '../../../shared/application/ports.js';
import { ReqContext } from '../../../shared/presentation/request-context.js';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import { MfaService } from '../application/mfa.service.js';
import type { AuthUser } from '../domain/user.js';
import { AllowDuringSetup, CurrentUser } from './decorators.js';

const CodeSchema = z.strictObject({ code: z.string().trim().min(6).max(32) });
type CodeBody = z.infer<typeof CodeSchema>;
const codePipe = new ZodValidationPipe(CodeSchema);

/** Verificação em duas etapas da própria conta (tela "Segurança"). */
@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @AllowDuringSetup()
  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.mfa.status(user.id);
  }

  /** Gera o segredo e o QR code. Nada é gravado até o código ser confirmado. */
  @AllowDuringSetup()
  @Post('setup')
  @HttpCode(200)
  setup(@CurrentUser() user: AuthUser) {
    return this.mfa.startEnrollment(user);
  }

  /** Confirma o primeiro código, ativa o MFA e devolve os códigos de recuperação (uma vez). */
  @AllowDuringSetup()
  @Post('enable')
  @HttpCode(200)
  enable(@CurrentUser() user: AuthUser, @Body(codePipe) body: CodeBody, @ReqContext() ctx: RequestContext) {
    return this.mfa.confirmEnrollment(user, body.code, ctx.ip);
  }

  /** Reconfirma o código para liberar ações sensíveis pelos próximos 5 minutos. */
  @Post('reauth')
  @HttpCode(204)
  async reauth(@CurrentUser() user: AuthUser, @Body(codePipe) body: CodeBody, @ReqContext() ctx: RequestContext) {
    await this.mfa.reauthenticate(user, body.code, ctx.ip);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  regenerate(@CurrentUser() user: AuthUser, @Body(codePipe) body: CodeBody, @ReqContext() ctx: RequestContext) {
    return this.mfa.regenerateRecoveryCodes(user, body.code, ctx.ip);
  }

  @Post('disable')
  @HttpCode(204)
  async disable(@CurrentUser() user: AuthUser, @Body(codePipe) body: CodeBody, @ReqContext() ctx: RequestContext) {
    await this.mfa.disable(user, body.code, ctx.ip);
  }
}
