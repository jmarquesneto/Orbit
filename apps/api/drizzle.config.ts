import { defineConfig } from 'drizzle-kit';

// Só gera SQL a partir do schema (não conecta no banco). As migrações são aplicadas pelo
// serviço "migrate" do docker-compose, com o papel dono do schema.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/database/schema.ts',
  out: './drizzle',
});
