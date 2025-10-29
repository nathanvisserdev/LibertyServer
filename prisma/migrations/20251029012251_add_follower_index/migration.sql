-- CreateTable
CREATE TABLE "Users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "dateOfBirth" DATETIME,
    "gender" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "zipCode" TEXT,
    "profilePhoto" TEXT NOT NULL,
    "about" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isPrivate" BOOLEAN NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "pendingRequestCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Groups" (
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

-- CreateTable
CREATE TABLE "Posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "groupId" TEXT,
    "media" TEXT,
    "orientation" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    CONSTRAINT "Posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Posts_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "ConnectionRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requesterId" TEXT NOT NULL,
    "requestedId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "ConnectionRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConnectionRequest_requestedId_fkey" FOREIGN KEY ("requestedId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requesterId" TEXT NOT NULL,
    "requestedId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "since" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Connections_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Connections_requestedId_fkey" FOREIGN KEY ("requestedId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserConnection" (
    "userId" TEXT NOT NULL,
    "otherUserId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "otherUserId", "type"),
    CONSTRAINT "UserConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserConnection_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Blocks" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("blockerId", "blockedId"),
    CONSTRAINT "Blocks_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Blocks_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Users_email_key" ON "Users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Users_username_key" ON "Users"("username");

-- CreateIndex
CREATE INDEX "Users_isPaid_idx" ON "Users"("isPaid");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- CreateIndex
CREATE INDEX "Groups_groupType_idx" ON "Groups"("groupType");

-- CreateIndex
CREATE INDEX "Groups_adminId_idx" ON "Groups"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "Groups_adminId_name_key" ON "Groups"("adminId", "name");

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

-- CreateIndex
CREATE INDEX "Posts_createdAt_idx" ON "Posts"("createdAt");

-- CreateIndex
CREATE INDEX "Posts_visibility_idx" ON "Posts"("visibility");

-- CreateIndex
CREATE INDEX "Posts_groupId_idx" ON "Posts"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_userId_groupId_key" ON "GroupMember"("userId", "groupId");

-- CreateIndex
CREATE INDEX "ConnectionRequest_requesterId_requestedId_type_status_idx" ON "ConnectionRequest"("requesterId", "requestedId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectionRequest_requesterId_requestedId_key" ON "ConnectionRequest"("requesterId", "requestedId");

-- CreateIndex
CREATE UNIQUE INDEX "Connections_requesterId_requestedId_type_key" ON "Connections"("requesterId", "requestedId", "type");

-- CreateIndex
CREATE INDEX "UserConnection_userId_type_createdAt_idx" ON "UserConnection"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "UserConnection_otherUserId_type_idx" ON "UserConnection"("otherUserId", "type");

-- CreateIndex
CREATE INDEX "Blocks_blockedId_idx" ON "Blocks"("blockedId");
