-- CreateTable
CREATE TABLE "GroupInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedById" TEXT,
    "voucherId" TEXT,
    "vouchStatus" TEXT DEFAULT 'ACCEPTED',
    "vouchNote" TEXT,
    CONSTRAINT "GroupInvite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupInvite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupInvite_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GroupInvite_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JoinGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedById" TEXT,
    "preferredReviewerId" TEXT,
    "voucherId" TEXT,
    "vouchStatus" TEXT,
    "vouchNote" TEXT,
    "relationshipType" TEXT,
    CONSTRAINT "JoinGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JoinGroup_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JoinGroup_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JoinGroup_preferredReviewerId_fkey" FOREIGN KEY ("preferredReviewerId") REFERENCES "Users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JoinGroup_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoundTable" (
    "groupId" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "viceChairId" TEXT,
    "roundTableType" TEXT NOT NULL DEFAULT 'AUTOCRATIC',
    "electionsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "electionCycle" TEXT,
    "absentDaysThreshold" INTEGER NOT NULL DEFAULT 5,
    "inactiveAdminVoteDays" INTEGER NOT NULL DEFAULT 30,
    CONSTRAINT "RoundTable_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RoundTable_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RoundTable_viceChairId_fkey" FOREIGN KEY ("viceChairId") REFERENCES "Users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoundTableMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CHAIRPERSON',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absentUntil" DATETIME,
    "plannedLeaveFrom" DATETIME,
    "plannedLeaveUntil" DATETIME,
    "plannedLeaveNote" TEXT,
    CONSTRAINT "RoundTableMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RoundTable" ("groupId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoundTableMotion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "createdById" TEXT,
    "showPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" DATETIME,
    "closedAt" DATETIME,
    "passed" BOOLEAN,
    CONSTRAINT "RoundTableMotion_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RoundTable" ("groupId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableMotion_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableMotion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoundTableVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "motionId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoundTableVote_motionId_fkey" FOREIGN KEY ("motionId") REFERENCES "RoundTableMotion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableVote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "RoundTableMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoundTableLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "actorId" TEXT,
    "unilateral" TEXT,
    "consensus" TEXT,
    "targetId" TEXT,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoundTableLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RoundTable" ("groupId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoundTableContinuity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoundTableContinuity_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RoundTable" ("groupId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableContinuity_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundTableContinuity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "adminId" TEXT NOT NULL,
    "groupJoinPolicy" TEXT NOT NULL DEFAULT 'CHAIR',
    CONSTRAINT "Groups_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Groups" ("adminId", "createdAt", "description", "groupType", "id", "isHidden", "name") SELECT "adminId", "createdAt", "description", "groupType", "id", "isHidden", "name" FROM "Groups";
DROP TABLE "Groups";
ALTER TABLE "new_Groups" RENAME TO "Groups";
CREATE INDEX "Groups_groupType_idx" ON "Groups"("groupType");
CREATE INDEX "Groups_adminId_idx" ON "Groups"("adminId");
CREATE UNIQUE INDEX "Groups_adminId_name_key" ON "Groups"("adminId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "GroupInvite_groupId_status_createdAt_idx" ON "GroupInvite"("groupId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "GroupInvite_inviteeId_status_idx" ON "GroupInvite"("inviteeId", "status");

-- CreateIndex
CREATE INDEX "GroupInvite_inviterId_idx" ON "GroupInvite"("inviterId");

-- CreateIndex
CREATE INDEX "GroupInvite_voucherId_vouchStatus_idx" ON "GroupInvite"("voucherId", "vouchStatus");

-- CreateIndex
CREATE UNIQUE INDEX "GroupInvite_groupId_inviteeId_key" ON "GroupInvite"("groupId", "inviteeId");

-- CreateIndex
CREATE INDEX "JoinGroup_groupId_status_createdAt_idx" ON "JoinGroup"("groupId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "JoinGroup_requesterId_status_idx" ON "JoinGroup"("requesterId", "status");

-- CreateIndex
CREATE INDEX "JoinGroup_preferredReviewerId_idx" ON "JoinGroup"("preferredReviewerId");

-- CreateIndex
CREATE INDEX "JoinGroup_voucherId_vouchStatus_idx" ON "JoinGroup"("voucherId", "vouchStatus");

-- CreateIndex
CREATE INDEX "RoundTable_adminId_idx" ON "RoundTable"("adminId");

-- CreateIndex
CREATE INDEX "RoundTable_viceChairId_idx" ON "RoundTable"("viceChairId");

-- CreateIndex
CREATE INDEX "RoundTable_roundTableType_idx" ON "RoundTable"("roundTableType");

-- CreateIndex
CREATE INDEX "RoundTableMember_groupId_role_idx" ON "RoundTableMember"("groupId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "RoundTableMember_groupId_userId_key" ON "RoundTableMember"("groupId", "userId");

-- CreateIndex
CREATE INDEX "RoundTableMotion_groupId_type_createdAt_idx" ON "RoundTableMotion"("groupId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "RoundTableVote_voterId_idx" ON "RoundTableVote"("voterId");

-- CreateIndex
CREATE UNIQUE INDEX "RoundTableVote_motionId_voterId_key" ON "RoundTableVote"("motionId", "voterId");

-- CreateIndex
CREATE INDEX "RoundTableLog_groupId_createdAt_idx" ON "RoundTableLog"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "RoundTableLog_groupId_unilateral_idx" ON "RoundTableLog"("groupId", "unilateral");

-- CreateIndex
CREATE INDEX "RoundTableLog_groupId_consensus_idx" ON "RoundTableLog"("groupId", "consensus");

-- CreateIndex
CREATE INDEX "RoundTableContinuity_groupId_idx" ON "RoundTableContinuity"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "RoundTableContinuity_groupId_rank_key" ON "RoundTableContinuity"("groupId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "RoundTableContinuity_groupId_userId_key" ON "RoundTableContinuity"("groupId", "userId");
