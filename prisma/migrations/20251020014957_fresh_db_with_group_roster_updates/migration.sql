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
INSERT INTO "new_GroupRoster" ("groupId", "joinedAt", "membershipId", "userId") SELECT "groupId", "joinedAt", "membershipId", "userId" FROM "GroupRoster";
DROP TABLE "GroupRoster";
ALTER TABLE "new_GroupRoster" RENAME TO "GroupRoster";
CREATE UNIQUE INDEX "GroupRoster_userId_groupId_key" ON "GroupRoster"("userId", "groupId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
