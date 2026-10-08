import { LoginUseCase } from '../../src/modules/auth/application/login.use-case.js';
import { SessionService } from '../../src/modules/auth/application/session.service.js';
import { UsersAdminService } from '../../src/modules/auth/application/users-admin.service.js';
import { InvitationsService } from '../../src/modules/invitations/application/invitations.service.js';
import { SettingsService } from '../../src/modules/settings/application/settings.service.js';
import {
  CountingRateLimiter,
  fakeHasher,
  fakeTokens,
  FixedClock,
  InMemoryInvitations,
  InMemorySessions,
  InMemorySettings,
  InMemoryUsers,
  MemoryBrandingCache,
  passthroughTx,
  RecordingAuditLog,
} from './fakes.js';

/** Monta os casos de uso com adaptadores em memória — sem banco, Redis ou Nest. */
export function buildHarness() {
  const clock = new FixedClock();
  const users = new InMemoryUsers();
  const sessionsRepo = new InMemorySessions();
  const invitationsRepo = new InMemoryInvitations();
  const settingsRepo = new InMemorySettings();
  const brandingCache = new MemoryBrandingCache();
  const audit = new RecordingAuditLog();
  const limiter = new CountingRateLimiter();
  const config = { accessTtlSeconds: 900, refreshTtlSeconds: 604_800 };

  const sessions = new SessionService(
    sessionsRepo,
    users,
    fakeTokens,
    config,
    audit,
    passthroughTx,
    clock,
  );
  const login = new LoginUseCase(users, fakeHasher, limiter, audit, passthroughTx, clock, sessions);
  const usersAdmin = new UsersAdminService(users, sessionsRepo, fakeHasher, audit, passthroughTx, clock);
  const settings = new SettingsService(settingsRepo, brandingCache, audit, passthroughTx, clock);
  const invitations = new InvitationsService(
    invitationsRepo,
    { build: (token) => `http://localhost:3000/convite#${token}` },
    users,
    fakeHasher,
    limiter,
    audit,
    passthroughTx,
    clock,
    settings,
    sessions,
  );

  return {
    clock,
    users,
    sessionsRepo,
    invitationsRepo,
    settingsRepo,
    brandingCache,
    audit,
    sessions,
    login,
    usersAdmin,
    settings,
    invitations,
  };
}

export const ctx = { ip: '203.0.113.7', userAgent: 'vitest' };
