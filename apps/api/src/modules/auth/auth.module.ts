import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.schema.js';
import { LoginUseCase } from './application/login.use-case.js';
import {
  ACCESS_TOKEN_SERVICE,
  AUTH_CONFIG,
  type AuthConfig,
  PASSWORD_HASHER,
  SESSION_REPOSITORY,
  USER_REPOSITORY,
} from './application/ports.js';
import { SessionService } from './application/session.service.js';
import { UsersAdminService } from './application/users-admin.service.js';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher.js';
import { DrizzleSessionRepository } from './infrastructure/drizzle-session.repository.js';
import { DrizzleUserRepository } from './infrastructure/drizzle-user.repository.js';
import { JoseAccessTokenService } from './infrastructure/jose-access-token.service.js';
import { AdminUsersController } from './presentation/admin-users.controller.js';
import { AuthCookies } from './presentation/auth-cookies.js';
import { AuthController } from './presentation/auth.controller.js';
import { JwtAuthGuard, RolesGuard } from './presentation/guards.js';

@Module({
  controllers: [AuthController, AdminUsersController],
  providers: [
    { provide: USER_REPOSITORY, useClass: DrizzleUserRepository },
    { provide: SESSION_REPOSITORY, useClass: DrizzleSessionRepository },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: ACCESS_TOKEN_SERVICE, useClass: JoseAccessTokenService },
    {
      provide: AUTH_CONFIG,
      inject: [ENV],
      useFactory: (env: Env): AuthConfig => ({
        accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
        refreshTtlSeconds: env.JWT_REFRESH_TTL_SECONDS,
      }),
    },
    SessionService,
    LoginUseCase,
    UsersAdminService,
    AuthCookies,
    // Ordem importa: primeiro autentica, depois confere o papel.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SessionService, UsersAdminService, AuthCookies, USER_REPOSITORY, PASSWORD_HASHER],
})
export class AuthModule {}
