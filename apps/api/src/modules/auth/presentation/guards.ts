import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CLOCK, type Clock } from '../../../shared/application/ports.js';
import {
  ForbiddenError,
  MfaReauthRequiredError,
  MfaSetupRequiredError,
  UnauthenticatedError,
} from '../../../shared/domain/errors.js';
import { MfaService } from '../application/mfa.service.js';
import { SessionService } from '../application/session.service.js';
import { MFA_REAUTH_WINDOW_MS, type Role } from '../domain/user.js';
import { AuthCookies } from './auth-cookies.js';
import {
  ALLOW_WITHOUT_MFA,
  type AuthenticatedRequest,
  IS_PUBLIC,
  REQUIRE_RECENT_MFA,
  ROLES_KEY,
} from './decorators.js';

/** Guard GLOBAL: toda rota exige um JWT válido, salvo as marcadas com @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly cookies: AuthCookies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.cookies.accessTokenFrom(req);
    if (!token) throw new UnauthenticatedError();
    req.user = await this.sessions.authenticate(token);
    return true;
  }
}

/**
 * Guard GLOBAL que roda depois do JWT:
 *  - instalação exige MFA e a pessoa ainda não cadastrou → só as rotas @AllowWithoutMfa;
 *  - rota @RequireRecentMfa → código confirmado nos últimos 5 minutos nesta sessão.
 */
@Injectable()
export class MfaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly mfa: MfaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) return true; // rota pública

    if (!user.mfaEnabled) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA, targets);
      if (!allowed && (await this.mfa.isRequired())) throw new MfaSetupRequiredError();
      return true; // sem MFA cadastrado (e não obrigatório) não há o que reconfirmar
    }

    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_RECENT_MFA, targets)) {
      const at = user.mfaVerifiedAt?.getTime() ?? 0;
      if (this.clock.now().getTime() - at > MFA_REAUTH_WINDOW_MS) throw new MfaReauthRequiredError();
    }
    return true;
  }
}

/** Guard GLOBAL que roda depois do JWT: aplica @Roles(...) quando presente. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenError();
    return true;
  }
}
