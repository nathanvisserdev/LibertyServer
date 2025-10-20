import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep parallel execution enabled
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 4,
        minThreads: 1,
      }
    },
    
    testTimeout: 60000, // Increase timeout for slow operations
    environment: 'node',
    env: {
      BCRYPT_ROUNDS: '1' // Fast hashing for tests
      // Let each test file use its own database to prevent conflicts
    },
    setupFiles: ['./vitest.setup.ts']
  },
});