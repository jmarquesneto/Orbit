import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { applyTestEnv } from './test-env.js';

/** Aplica as migrações reais (com o papel migrador) antes da suíte, como o serviço "migrate". */
export default async function setup(): Promise<void> {
  applyTestEnv();
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_MIGRATOR_USER,
    password: process.env.DB_MIGRATOR_PASSWORD,
  });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
  } catch (err) {
    throw new Error(
      `Banco de teste indisponível. Suba com: docker compose -f docker-compose.test.yml up -d\n${String(err)}`,
    );
  } finally {
    await pool.end();
  }
}
