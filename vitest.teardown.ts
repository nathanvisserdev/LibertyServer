import { afterAll } from 'vitest';
import { unlinkSync } from 'fs';

// Delete the test database file after all tests in this worker have finished

afterAll(async () => {
  const workerId = process.env.VITEST_WORKER_ID || '0';
  const dbPath = `./prisma/test-${workerId}.db`;
  try {
    unlinkSync(dbPath);
    // Optionally, log cleanup
    // console.log(`Deleted test DB: ${dbPath}`);
  } catch (err) {
    // Ignore if file does not exist or can't be deleted
  }
});
