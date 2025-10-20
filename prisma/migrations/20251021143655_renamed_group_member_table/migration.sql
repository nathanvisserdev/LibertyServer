/*
  Warnings:

  - You are about to drop the `GroupRoster` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "GroupRoster_userId_groupId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "GroupRoster";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "GroupMember" (
    "membershipId" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    "allowBoardInvites" BOOLEAN NOT NULL DEFAULT false,
    "adminId" TEXT NOT NULL,
    "groupJoinPolicy" TEXT NOT NULL DEFAULT 'CHAIR',
    "vouchingEnabled" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Groups_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Groups" ("adminId", "createdAt", "description", "groupJoinPolicy", "groupType", "id", "isHidden", "membershipHidden", "name") SELECT "adminId", "createdAt", "description", "groupJoinPolicy", "groupType", "id", "isHidden", "membershipHidden", "name" FROM "Groups";
DROP TABLE "Groups";
ALTER TABLE "new_Groups" RENAME TO "Groups";
CREATE INDEX "Groups_groupType_idx" ON "Groups"("groupType");
CREATE INDEX "Groups_adminId_idx" ON "Groups"("adminId");
CREATE UNIQUE INDEX "Groups_adminId_name_key" ON "Groups"("adminId", "name");
CREATE TABLE "new_RoundTableMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CHAIRPERSON',
    "isModerator" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absentUntil" DATETIME,
    "plannedLeaveFrom" DATETIME,
    "plannedLeaveUntil" DATETIME,
    "plannedLeaveNote" TEXT,
    CONSTRAINT "RoundTableMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RoundTable" ("groupId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RoundTableMember" ("absentUntil", "groupId", "id", "joinedAt", "plannedLeaveFrom", "plannedLeaveNote", "plannedLeaveUntil", "role", "userId") SELECT "absentUntil", "groupId", "id", "joinedAt", "plannedLeaveFrom", "plannedLeaveNote", "plannedLeaveUntil", "role", "userId" FROM "RoundTableMember";
DROP TABLE "RoundTableMember";
ALTER TABLE "new_RoundTableMember" RENAME TO "RoundTableMember";
CREATE INDEX "RoundTableMember_groupId_role_idx" ON "RoundTableMember"("groupId", "role");
CREATE UNIQUE INDEX "RoundTableMember_groupId_userId_key" ON "RoundTableMember"("groupId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_userId_groupId_key" ON "GroupMember"("userId", "groupId");
