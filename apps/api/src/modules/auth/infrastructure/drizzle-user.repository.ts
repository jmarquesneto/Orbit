import { Injectable } from '@nestjs/common';
import { asc, count, eq } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { users } from '../../../infrastructure/database/schema.js';
import type { UserRecord, UserStatus } from '../domain/user.js';
import type { UserRepository } from '../application/ports.js';

const columns = {
  id: users.id,
  email: users.email,
  passwordHash: users.passwordHash,
  role: users.role,
  status: users.status,
  failedLogins: users.failedLogins,
  lockedUntil: users.lockedUntil,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  mfaEnabled: users.mfaEnabled,
  mfaSecret: users.mfaSecret,
  mfaLastStep: users.mfaLastStep,
};

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly ctx: DbContext) {}

  async findById(id: string): Promise<UserRecord | null> {
    const [row] = await this.ctx.db.select(columns).from(users).where(eq(users.id, id));
    return row ?? null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    // citext: comparação sem diferenciar maiúsculas, feita pelo próprio Postgres.
    const [row] = await this.ctx.db.select(columns).from(users).where(eq(users.email, email));
    return row ?? null;
  }

  async create(data: Parameters<UserRepository['create']>[0]): Promise<UserRecord> {
    const [row] = await this.ctx.db
      .insert(users)
      .values({ email: data.email, passwordHash: data.passwordHash, role: data.role, createdAt: data.at })
      .returning(columns);
    if (!row) throw new Error('Falha ao criar usuário');
    return row;
  }

  async updateLoginState(id: string, state: Parameters<UserRepository['updateLoginState']>[1]) {
    await this.ctx.db.update(users).set(state).where(eq(users.id, id));
  }

  async updateStatus(id: string, status: UserStatus) {
    await this.ctx.db.update(users).set({ status }).where(eq(users.id, id));
  }

  async setMfa(id: string, data: { enabled: boolean; secret: Buffer | null; lastStep: number | null }) {
    await this.ctx.db
      .update(users)
      .set({ mfaEnabled: data.enabled, mfaSecret: data.secret, mfaLastStep: data.lastStep })
      .where(eq(users.id, id));
  }

  async setMfaLastStep(id: string, step: number) {
    await this.ctx.db.update(users).set({ mfaLastStep: step }).where(eq(users.id, id));
  }

  list(): Promise<UserRecord[]> {
    return this.ctx.db.select(columns).from(users).orderBy(asc(users.createdAt));
  }

  async countAdmins(): Promise<number> {
    const [row] = await this.ctx.db.select({ n: count() }).from(users).where(eq(users.role, 'admin'));
    return row?.n ?? 0;
  }
}
