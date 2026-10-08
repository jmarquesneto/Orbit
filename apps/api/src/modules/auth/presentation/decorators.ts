import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser, Role } from '../domain/user.js';

export const IS_PUBLIC = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/** Rota acessível sem login. Tudo que NÃO tem este decorator exige JWT válido. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restringe a rota aos papéis informados (ex.: @Roles('admin')). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export type AuthenticatedRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new Error('CurrentUser usado em rota pública');
  return user;
});

export const ALLOW_WITHOUT_MFA = 'auth:allowWithoutMfa';
export const REQUIRE_RECENT_MFA = 'auth:requireRecentMfa';

/**
 * Rota liberada para quem ainda não configurou o MFA numa instalação que o exige
 * (ex.: /auth/me, logout e o próprio cadastro do app autenticador).
 */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA, true);

/** Ação sensível: exige o código do MFA confirmado nos últimos 5 minutos. */
export const RequireRecentMfa = () => SetMetadata(REQUIRE_RECENT_MFA, true);
