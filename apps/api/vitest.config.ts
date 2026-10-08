import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC preserva os metadados de decorators que a injeção de dependência do NestJS exige.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    coverage: { include: ['src/**/*.ts'], exclude: ['src/main.ts', 'src/**/*.spec.ts'] },
  },
});
