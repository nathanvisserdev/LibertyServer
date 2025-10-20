/*
  Warnings:

  - You are about to drop the column `isHidden` on the `GroupRoster` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GroupRoster" (
    "membershipId" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "GroupRoster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupRoster_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_GroupRoster" ("groupId", "isBanned", "joinedAt", "membershipId", "userId") SELECT "groupId", "isBanned", "joinedAt", "membershipId", "userId" FROM "GroupRoster";
DROP TABLE "GroupRoster";
ALTER TABLE "new_GroupRoster" RENAME TO "GroupRoster";
CREATE UNIQUE INDEX "GroupRoster_userId_groupId_key" ON "GroupRoster"("userId", "groupId");
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
    CONSTRAINT "Groups_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Groups" ("adminId", "createdAt", "description", "groupJoinPolicy", "groupType", "id", "isHidden", "name") SELECT "adminId", "createdAt", "description", "groupJoinPolicy", "groupType", "id", "isHidden", "name" FROM "Groups";
DROP TABLE "Groups";
ALTER TABLE "new_Groups" RENAME TO "Groups";
CREATE INDEX "Groups_groupType_idx" ON "Groups"("groupType");
CREATE INDEX "Groups_adminId_idx" ON "Groups"("adminId");
CREATE UNIQUE INDEX "Groups_adminId_name_key" ON "Groups"("adminId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
