import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenError, UnauthenticatedError } from '../../../shared/domain/errors.js';
import { SessionService } from '../application/session.service.js';
import type { Role } from '../domain/user.js';
import { AuthCookies } from './auth-cookies.js';
import { type AuthenticatedRequest, IS_PUBLIC, ROLES_KEY } from './decorators.js';

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
