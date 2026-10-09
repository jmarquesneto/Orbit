import { z } from 'zod';
import { withSecretFiles } from './secret-files.js';

/**
 * Um segredo precisa ter ao menos 256 bits de entropia (32 bytes → 43+ chars em base64)
 * e não pode ser um valor de exemplo esquecido no .env.
 */
const secret = (name: string) =>
  z
    .string({ error: `${name} é obrigatório` })
    .min(43, `${name} deve ter ao menos 32 bytes aleatórios (use scripts/generate-env.sh)`)
    .refine((v) => !/change[-_ ]?me|example|secret123/i.test(v), {
      message: `${name} parece um valor de exemplo`,
    });

const port = z.coerce.number().int().min(1).max(65535);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    API_PORT: port.default(4000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    /** Origem pública do frontend — usada em CORS e na checagem de Origin (CSRF). */
    /**
     * Opcional: o site aceita ser aberto por qualquer endereço do próprio servidor (o proxy
     * do frontend informa qual), e os links de convite usam o endereço do navegador.
     */
    WEB_ORIGIN: z.url().default('http://localhost:3010'),

    DB_HOST: z.string().min(1),
    DB_PORT: port.default(5432),
    DB_NAME: z.string().min(1),
    DB_APP_USER: z.string().min(1),
    DB_APP_PASSWORD: secret('DB_APP_PASSWORD'),

    REDIS_HOST: z.string().min(1),
    REDIS_PORT: port.default(6379),
    REDIS_PASSWORD: secret('REDIS_PASSWORD'),

    JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),

    /** Assina cookies de sessão e o token CSRF (double-submit). */
    SESSION_SECRET: secret('SESSION_SECRET'),

    /**
     * Primeiro acesso sem terminal (ex.: NAS): se ainda não existir nenhum administrador,
     * a API cria este com uma senha provisória mostrada no log, a trocar no 1º login.
     */
    BOOTSTRAP_ADMIN_EMAIL: z.preprocess((v) => (v === '' ? undefined : v), z.email().max(254).optional()),
    BOOTSTRAP_ADMIN_NAME: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(60).optional()),

    /** Chave AES-256-GCM (32 bytes em base64) para dados sensíveis em repouso, ex.: segredo MFA. */
    DATA_ENCRYPTION_KEY: z
      .string({ error: 'DATA_ENCRYPTION_KEY é obrigatório' })
      .refine((v) => Buffer.from(v, 'base64').length === 32, {
        message: 'DATA_ENCRYPTION_KEY deve ser 32 bytes codificados em base64',
      }),
  })
  .superRefine((env, ctx) => {
    const secrets = [
      env.JWT_ACCESS_SECRET,
      env.JWT_REFRESH_SECRET,
      env.SESSION_SECRET,
      env.DATA_ENCRYPTION_KEY,
    ];
    if (new Set(secrets).size !== secrets.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, SESSION_SECRET e DATA_ENCRYPTION_KEY devem ser distintos',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Valida o ambiente uma única vez no boot. Falha rápido, sem vazar os valores no erro. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(withSecretFiles(source));
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuração de ambiente inválida:\n${problems}`);
  }
  return result.data;
}
