import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // Node runtime lacks the `react-server` export condition, so map the
      // `server-only` boundary marker to a no-op stub for unit tests.
      'server-only': path.join(rootDir, '__tests__', 'server-only-stub.ts'),
      // Mirror tsconfig paths so services using `@/` imports stay testable.
      '@': path.join(rootDir, 'src'),
    },
  },
});
