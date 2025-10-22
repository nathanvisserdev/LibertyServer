-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RoundTableMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CHAIRPERSON',
    "isModerator" BOOLEAN NOT NULL DEFAULT false,
    "isExpelled" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absentUntil" DATETIME,
    "plannedLeaveFrom" DATETIME,
    "plannedLeaveUntil" DATETIME,
    "plannedLeaveNote" TEXT,
    CONSTRAINT "RoundTableMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RoundTable" ("groupId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RoundTableMember" ("absentUntil", "groupId", "id", "isModerator", "joinedAt", "plannedLeaveFrom", "plannedLeaveNote", "plannedLeaveUntil", "role", "userId") SELECT "absentUntil", "groupId", "id", "isModerator", "joinedAt", "plannedLeaveFrom", "plannedLeaveNote", "plannedLeaveUntil", "role", "userId" FROM "RoundTableMember";
DROP TABLE "RoundTableMember";
ALTER TABLE "new_RoundTableMember" RENAME TO "RoundTableMember";
CREATE INDEX "RoundTableMember_groupId_role_idx" ON "RoundTableMember"("groupId", "role");
CREATE UNIQUE INDEX "RoundTableMember_groupId_userId_key" ON "RoundTableMember"("groupId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
