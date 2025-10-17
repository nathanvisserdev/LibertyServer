-- CreateTable
CREATE TABLE "Users" (
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
    "photo" TEXT,
    "about" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "isBanned" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "groupType" TEXT NOT NULL DEFAULT 'PRIVATE',
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "adminId" TEXT NOT NULL,
    CONSTRAINT "Groups_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "groupId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    CONSTRAINT "Posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Posts_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupRoster" (
    "membershipId" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupRoster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupRoster_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
CREATE INDEX "Groups_groupType_idx" ON "Groups"("groupType");

-- CreateIndex
CREATE INDEX "Groups_adminId_idx" ON "Groups"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "Groups_adminId_name_key" ON "Groups"("adminId", "name");

-- CreateIndex
CREATE INDEX "Posts_createdAt_idx" ON "Posts"("createdAt");

-- CreateIndex
CREATE INDEX "Posts_visibility_idx" ON "Posts"("visibility");

-- CreateIndex
CREATE INDEX "Posts_groupId_idx" ON "Posts"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupRoster_userId_groupId_key" ON "GroupRoster"("userId", "groupId");

-- CreateIndex
CREATE INDEX "ConnectionRequest_requesterId_requestedId_type_status_idx" ON "ConnectionRequest"("requesterId", "requestedId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Connections_requesterId_requestedId_type_key" ON "Connections"("requesterId", "requestedId", "type");

-- CreateIndex
CREATE INDEX "Blocks_blockedId_idx" ON "Blocks"("blockedId");
