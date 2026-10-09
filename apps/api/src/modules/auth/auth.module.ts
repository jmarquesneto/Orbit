import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.schema.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AccountService } from './application/account.service.js';
import { BootstrapAdminService } from './application/bootstrap-admin.service.js';
import { LoginUseCase } from './application/login.use-case.js';
import { MfaService } from './application/mfa.service.js';
import {
  ACCESS_TOKEN_SERVICE,
  AUTH_CONFIG,
  type AuthConfig,
  PASSWORD_HASHER,
  QR_RENDERER,
  RECOVERY_CODE_REPOSITORY,
  SECRET_CIPHER,
  SESSION_REPOSITORY,
  USER_REPOSITORY,
} from './application/ports.js';
import { SessionService } from './application/session.service.js';
import { UsersAdminService } from './application/users-admin.service.js';
import { AesGcmCipher } from './infrastructure/aes-gcm-cipher.js';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher.js';
import { DrizzleRecoveryCodeRepository } from './infrastructure/drizzle-recovery-code.repository.js';
import { DrizzleSessionRepository } from './infrastructure/drizzle-session.repository.js';
import { DrizzleUserRepository } from './infrastructure/drizzle-user.repository.js';
import { JoseAccessTokenService } from './infrastructure/jose-access-token.service.js';
import { SvgQrRenderer } from './infrastructure/svg-qr-renderer.js';
import { AdminUsersController } from './presentation/admin-users.controller.js';
import { AuthCookies } from './presentation/auth-cookies.js';
import { AuthController } from './presentation/auth.controller.js';
import { JwtAuthGuard, MfaGuard, RolesGuard } from './presentation/guards.js';
import { MfaController } from './presentation/mfa.controller.js';

@Module({
  imports: [SettingsModule],
  controllers: [AuthController, MfaController, AdminUsersController],
  providers: [
    { provide: USER_REPOSITORY, useClass: DrizzleUserRepository },
    { provide: SESSION_REPOSITORY, useClass: DrizzleSessionRepository },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: ACCESS_TOKEN_SERVICE, useClass: JoseAccessTokenService },
    { provide: RECOVERY_CODE_REPOSITORY, useClass: DrizzleRecoveryCodeRepository },
    { provide: SECRET_CIPHER, useClass: AesGcmCipher },
    { provide: QR_RENDERER, useClass: SvgQrRenderer },
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
    AccountService,
    BootstrapAdminService,
    MfaService,
    UsersAdminService,
    AuthCookies,
    // Ordem importa: primeiro autentica, depois MFA, depois confere o papel.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MfaGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SessionService, MfaService, UsersAdminService, AuthCookies, USER_REPOSITORY, PASSWORD_HASHER],
})
export class AuthModule {}
