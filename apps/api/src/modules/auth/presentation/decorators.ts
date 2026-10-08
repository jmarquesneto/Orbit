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
