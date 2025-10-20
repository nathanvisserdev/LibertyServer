import { beforeAll } from 'vitest';
import { execSync } from 'child_process';

beforeAll(async () => {
  // Create unique database for each test worker thread
  const workerId = process.env.VITEST_WORKER_ID || '0';
  const dbPath = `file:./prisma/test-${workerId}.db`;
  
  process.env.DATABASE_URL = dbPath;
  
  // Initialize the database schema for this worker
  try {
    execSync('npx prisma db push --force-reset --skip-generate', { 
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: dbPath }
    });
  } catch (error) {
    console.warn(`Failed to initialize test database for worker ${workerId}:`, error);
  }
});