/*
  Warnings:

  - You are about to drop the column `allowBoardInvites` on the `Groups` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "groupType" TEXT NOT NULL DEFAULT 'PRIVATE',
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "membershipHidden" BOOLEAN NOT NULL DEFAULT false,
    "adminId" TEXT NOT NULL,
    "groupJoinPolicy" TEXT NOT NULL DEFAULT 'CHAIR',
    "vouchingEnabled" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Groups_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Groups" ("adminId", "createdAt", "description", "groupJoinPolicy", "groupType", "id", "isHidden", "membershipHidden", "name", "vouchingEnabled") SELECT "adminId", "createdAt", "description", "groupJoinPolicy", "groupType", "id", "isHidden", "membershipHidden", "name", "vouchingEnabled" FROM "Groups";
DROP TABLE "Groups";
ALTER TABLE "new_Groups" RENAME TO "Groups";
CREATE INDEX "Groups_groupType_idx" ON "Groups"("groupType");
CREATE INDEX "Groups_adminId_idx" ON "Groups"("adminId");
CREATE UNIQUE INDEX "Groups_adminId_name_key" ON "Groups"("adminId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
