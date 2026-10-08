/**
 * Aplica as migrações pendentes com o papel DONO do schema (DB_MIGRATOR_*).
 * Roda como serviço one-shot ("migrate") antes da API subir; a API em si nunca tem DDL.
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não definida`);
  return value;
}

async function main(): Promise<void> {
  const pool = new Pool({
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    database: required('DB_NAME'),
    user: required('DB_MIGRATOR_USER'),
    password: required('DB_MIGRATOR_PASSWORD'),
    application_name: 'migrate',
  });
  try {
    const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));
    await migrate(drizzle(pool), { migrationsFolder });
    process.stdout.write('Migrações aplicadas.\n');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Falha nas migrações: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
