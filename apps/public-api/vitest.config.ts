import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: [
      fileURLToPath(
        new URL('../../packages/database/tests/isolated-venue-roles.setup.ts', import.meta.url)
      )
    ]
  }
});
