import { PrismaClient } from "./generated/prisma/index.js";

// Singleton PrismaClient instance
// In tests: each worker uses its own database file (set by test files)
// In production/dev: uses the DATABASE_URL from .env
let prisma: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    // DATABASE_URL should already be set by test files before this module loads
    // If in test mode, it will be file:./prisma/test-{workerId}.db
    // If in dev/prod mode, it will be from .env
    prisma = new PrismaClient();
  }
  return prisma;
}

// Reset the singleton (used in tests to ensure clean state between test files)
export function resetPrismaClient(): void {
  if (prisma) {
    prisma.$disconnect();
    prisma = null;
  }
}

// Export a default instance for convenience
export const prismaClient = getPrismaClient();
