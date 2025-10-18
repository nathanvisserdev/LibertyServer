import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Re-enable parallel execution
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 4,
        minThreads: 1,
      }
    },
    
    testTimeout: 20000,
    environment: 'node',
  },
});