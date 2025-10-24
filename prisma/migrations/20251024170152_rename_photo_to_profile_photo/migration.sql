/*
  Warnings:

  - You are about to drop the column `photo` on the `Users` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "dateOfBirth" DATETIME,
    "gender" TEXT,
    "phoneNumber" TEXT,
    "zipCode" TEXT,
    "profilePhoto" TEXT,
    "about" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "pendingRequestCount" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_Users" ("about", "createdAt", "dateOfBirth", "email", "firstName", "gender", "id", "isBanned", "isHidden", "isPaid", "isPrivate", "lastName", "password", "pendingRequestCount", "phoneNumber", "updatedAt", "username", "zipCode") SELECT "about", "createdAt", "dateOfBirth", "email", "firstName", "gender", "id", "isBanned", "isHidden", "isPaid", "isPrivate", "lastName", "password", "pendingRequestCount", "phoneNumber", "updatedAt", "username", "zipCode" FROM "Users";
DROP TABLE "Users";
ALTER TABLE "new_Users" RENAME TO "Users";
CREATE UNIQUE INDEX "Users_email_key" ON "Users"("email");
CREATE UNIQUE INDEX "Users_username_key" ON "Users"("username");
CREATE INDEX "Users_isPaid_idx" ON "Users"("isPaid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
