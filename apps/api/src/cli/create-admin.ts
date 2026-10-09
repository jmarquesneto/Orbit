/**
 * Cria um administrador e mostra a senha gerada UMA vez.
 * Uso:  docker compose run --rm api node dist/cli/create-admin.js voce@exemplo.com "Seu Nome"
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { UsersAdminService } from '../modules/auth/application/users-admin.service.js';
import { DomainError } from '../shared/domain/errors.js';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    process.stderr.write('Uso: node dist/cli/create-admin.js <email> ["Seu Nome"]\n');
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const { user, password } = await app.get(UsersAdminService).bootstrapAdmin(email, process.argv[3]);
    process.stdout.write(
      [
        '',
        'Administrador criado com sucesso.',
        `  E-mail: ${user.email}`,
        `  Senha:  ${password}`,
        '',
        'Guarde esta senha agora: ela não será mostrada de novo.',
        '',
      ].join('\n'),
    );
  } catch (err) {
    process.stderr.write(`Erro: ${err instanceof DomainError ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
