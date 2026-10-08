import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Testes de integração: API completa contra Postgres e Redis reais (docker-compose.test.yml).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.int-spec.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
