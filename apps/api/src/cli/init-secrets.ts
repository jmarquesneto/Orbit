/**
 * Gera os segredos internos na primeira subida (serviço "secrets" do compose).
 * Uso: node dist/cli/init-secrets.js [pasta]   (padrão: $SECRETS_DIR ou /secrets)
 */
import { ensureSecretFiles } from '../config/secret-files.js';

const dir = process.argv[2] ?? process.env.SECRETS_DIR ?? '/secrets';
try {
  const created = ensureSecretFiles(dir);
  process.stdout.write(
    created.length
      ? `Segredos criados em ${dir}: ${created.length}. Faça backup desta pasta junto com o banco.\n`
      : `Segredos já existentes em ${dir}. Nada a fazer.\n`,
  );
} catch (err) {
  process.stderr.write(`Não foi possível preparar os segredos em ${dir}: ${String(err)}\n`);
  process.exit(1);
}
