// Set per-worker test database BEFORE any imports
process.env.DATABASE_URL = `file:./prisma/test-${process.env.VITEST_WORKER_ID || '0'}.db`;

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prismaClient as prisma } from "../prismaClient.js";
import request from "supertest";
import { app } from "../index.js";
import jwt from "jsonwebtoken";
import { fileURLToPath } from 'url';
import path from 'path';
import { generateUniqueEmail, generateUniqueUsername, generateTestNamespace, generateUniqueString } from './testUtils.js';

const __filename = fileURLToPath(import.meta.url);
const testFileName = path.basename(__filename, '.spec.ts');
const testNamespace = generateTestNamespace(testFileName);

const JWT_SECRET = process.env.JWT_SECRET ?? "";

// Helper to create user directly in database
async function createTestUser(prefix: string) {
  const email = generateUniqueEmail(prefix, testNamespace);
  const username = generateUniqueUsername(testNamespace);
  const password = "testpass123";

  const user = await prisma.user.create({
    data: {
      email,
      username,
      password,
      firstName: "Test",
      lastName: "User",
      dateOfBirth: new Date("1990-01-01"),
      gender: "MALE",
      profilePhoto: "https://example.com/photo.jpg",
      isPrivate: false,
    }
  });

  const token = jwt.sign({ id: user.id }, JWT_SECRET);

  return {
    userId: user.id,
    token,
  };
}

// Helper to create a connection between two users
async function createConnection(user1Id: string, user2Id: string, type: "ACQUAINTANCE" | "STRANGER" = "ACQUAINTANCE") {
  // For mutual connections, ensure requesterId < requestedId
  const [requesterId, requestedId] = user1Id < user2Id ? [user1Id, user2Id] : [user2Id, user1Id];
  
  const connection = await prisma.connection.create({
    data: {
      requesterId,
      requestedId,
      type,
    }
  });

  // Create UserConnection entries for both users
  await prisma.userConnection.createMany({
    data: [
      {
        userId: user1Id,
        otherUserId: user2Id,
        connectionId: connection.id,
        type,
      },
      {
        userId: user2Id,
        otherUserId: user1Id,
        connectionId: connection.id,
        type,
      }
    ]
  });

  return connection;
}

describe("SubNet Members API", () => {
  let ownerUserId: string;
  let ownerToken: string;
  let memberUserId: string;
  let memberToken: string;
  let strangerUserId: string;
  let strangerToken: string;
  let testSubnetId: string;

  beforeAll(async () => {
    // Create test users
    const owner = await createTestUser("owner");
    ownerUserId = owner.userId;
    ownerToken = owner.token;

    const member = await createTestUser("member");
    memberUserId = member.userId;
    memberToken = member.token;

    const stranger = await createTestUser("stranger");
    strangerUserId = stranger.userId;
    strangerToken = stranger.token;

    // Create connections between owner and member (ACQUAINTANCE)
    await createConnection(ownerUserId, memberUserId, "ACQUAINTANCE");

    // Create a subnet owned by owner
    const subnetRes = await request(app)
      .post("/subnets")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: generateUniqueString("Test Subnet", testNamespace),
        description: "A test subnet for member tests",
        visibility: "PRIVATE"
      });

    testSubnetId = subnetRes.body.id;
  });

  afterAll(async () => {
    // Cleanup
    if (ownerUserId && memberUserId && strangerUserId) {
      await prisma.subNetMember.deleteMany({
        where: {
          subNetId: testSubnetId
        }
      });
      await prisma.subNet.deleteMany({
        where: {
          ownerId: { in: [ownerUserId, memberUserId, strangerUserId] },
        },
      });
      await prisma.userConnection.deleteMany({
        where: {
          userId: { in: [ownerUserId, memberUserId, strangerUserId] }
        }
      });
      await prisma.connection.deleteMany({
        where: {
          OR: [
            { requesterId: { in: [ownerUserId, memberUserId, strangerUserId] } },
            { requestedId: { in: [ownerUserId, memberUserId, strangerUserId] } }
          ]
        }
      });
      await prisma.user.deleteMany({
        where: { id: { in: [ownerUserId, memberUserId, strangerUserId] } },
      });
    }
  });

  describe("POST /subnets/:id/members", () => {
    it("should add a connected user as a member", async () => {
      const res = await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          userId: memberUserId,
          role: "VIEWER"
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.userId).toBe(memberUserId);
      expect(res.body.subNetId).toBe(testSubnetId);
      expect(res.body.role).toBe("VIEWER");
      expect(res.body).toHaveProperty("user");
      expect(res.body.user.id).toBe(memberUserId);
    });

    it("should add member with default VIEWER role when not specified", async () => {
      // First remove the existing member
      await request(app)
        .delete(`/subnets/${testSubnetId}/members/${memberUserId}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      const res = await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          userId: memberUserId
        });

      expect(res.status).toBe(201);
      expect(res.body.role).toBe("VIEWER");
    });

    it("should reject adding member without userId or userIds", async () => {
      const res = await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          role: "VIEWER"
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Either userId or userIds is required");
    });

    it("should reject invalid role", async () => {
      const res = await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          userId: memberUserId,
          role: "INVALID_ROLE"
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid role");
    });

    it("should reject OWNER role assignment", async () => {
      const res = await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          userId: memberUserId,
          role: "OWNER"
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Cannot assign OWNER role");
    });

    it("should reject adding yourself as member", async () => {
      const res = await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          userId: ownerUserId
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Cannot add yourself");
    });

    it("should reject duplicate member", async () => {
      const res = await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          userId: memberUserId
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("already members of this subnet");
    });

    it("should reject adding user without connection", async () => {
      const res = await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          userId: strangerUserId
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("must be connected");
    });

    it("should reject when not subnet owner", async () => {
      const res = await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          userId: strangerUserId
        });

      expect(res.status).toBe(403);
    });

    it("should reject for non-existent subnet", async () => {
      const res = await request(app)
        .post("/subnets/nonexistent/members")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          userId: memberUserId
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Subnet not found");
    });

    it("should reject for non-existent user", async () => {
      const res = await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          userId: "nonexistent-user-id"
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("One or more users not found");
    });

    it("should support different role types", async () => {
      // Test MANAGER role
      await request(app)
        .delete(`/subnets/${testSubnetId}/members/${memberUserId}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      const managerRes = await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          userId: memberUserId,
          role: "MANAGER"
        });

      expect(managerRes.status).toBe(201);
      expect(managerRes.body.role).toBe("MANAGER");

      // Test CONTRIBUTOR role
      await request(app)
        .delete(`/subnets/${testSubnetId}/members/${memberUserId}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      const contributorRes = await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          userId: memberUserId,
          role: "CONTRIBUTOR"
        });

      expect(contributorRes.status).toBe(201);
      expect(contributorRes.body.role).toBe("CONTRIBUTOR");
    });

    it("should increment memberCount when adding member", async () => {
      // First ensure member is not in the subnet
      await request(app)
        .delete(`/subnets/${testSubnetId}/members/${memberUserId}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      // Get count after removal (should be 0)
      const beforeSubnet = await prisma.subNet.findUnique({
        where: { id: testSubnetId },
        select: { memberCount: true }
      });

      // Add member
      await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ userId: memberUserId });

      const afterSubnet = await prisma.subNet.findUnique({
        where: { id: testSubnetId },
        select: { memberCount: true }
      });

      expect(afterSubnet?.memberCount).toBe((beforeSubnet?.memberCount || 0) + 1);
    });
  });

  describe("DELETE /subnets/:id/members/:userId", () => {
    it("should remove a member from subnet", async () => {
      const res = await request(app)
        .delete(`/subnets/${testSubnetId}/members/${memberUserId}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      expect(res.status).toBe(204);

      // Verify member was removed
      const member = await prisma.subNetMember.findUnique({
        where: {
          subNetId_userId: {
            subNetId: testSubnetId,
            userId: memberUserId
          }
        }
      });

      expect(member).toBeNull();
    });

    it("should decrement memberCount when removing member", async () => {
      // Re-add member first
      await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ userId: memberUserId });

      const beforeSubnet = await prisma.subNet.findUnique({
        where: { id: testSubnetId },
        select: { memberCount: true }
      });

      await request(app)
        .delete(`/subnets/${testSubnetId}/members/${memberUserId}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      const afterSubnet = await prisma.subNet.findUnique({
        where: { id: testSubnetId },
        select: { memberCount: true }
      });

      expect(afterSubnet?.memberCount).toBe((beforeSubnet?.memberCount || 0) - 1);
    });

    it("should reject when not subnet owner", async () => {
      // Re-add member first
      await request(app)
        .post(`/subnets/${testSubnetId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ userId: memberUserId });

      const res = await request(app)
        .delete(`/subnets/${testSubnetId}/members/${memberUserId}`)
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(403);
    });

    it("should reject removing yourself (owner)", async () => {
      const res = await request(app)
        .delete(`/subnets/${testSubnetId}/members/${ownerUserId}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Cannot remove yourself");
    });

    it("should return 404 for non-existent member", async () => {
      const res = await request(app)
        .delete(`/subnets/${testSubnetId}/members/${strangerUserId}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Member not found");
    });

    it("should return 404 for non-existent subnet", async () => {
      const res = await request(app)
        .delete("/subnets/nonexistent/members/someuser")
        .set("Authorization", `Bearer ${ownerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Subnet not found");
    });

    it("should require authentication", async () => {
      const res = await request(app)
        .delete(`/subnets/${testSubnetId}/members/${memberUserId}`);

      expect(res.status).toBe(401);
    });
  });
});
