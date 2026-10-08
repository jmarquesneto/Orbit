/**
 * Desativa o MFA de uma conta (ex.: o único administrador perdeu o celular e os códigos).
 * Uso:  docker compose run --rm api node dist/cli/reset-mfa.js voce@exemplo.com
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { USER_REPOSITORY, type UserRepository } from '../modules/auth/application/ports.js';
import { MfaService } from '../modules/auth/application/mfa.service.js';
import { DomainError } from '../shared/domain/errors.js';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    process.stderr.write('Uso: node dist/cli/reset-mfa.js <email>\n');
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const user = await app.get<UserRepository>(USER_REPOSITORY).findByEmail(email);
    if (!user) throw new Error('Usuário não encontrado.');
    await app.get(MfaService).adminReset(null, user.id, null);
    process.stdout.write(
      `\nMFA desativado para ${user.email}. No próximo login a pessoa cadastra o app de novo.\n\n`,
    );
  } catch (err) {
    process.stderr.write(`Erro: ${err instanceof DomainError || err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
