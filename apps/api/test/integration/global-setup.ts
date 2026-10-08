import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
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

  // O Redis de teste sobrevive entre execuções: zera os contadores de tentativas (login,
  // MFA, upload) para que rodar a suíte duas vezes seguidas não esbarre no rate limit.
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
}
