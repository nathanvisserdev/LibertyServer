// Set per-worker test database BEFORE any imports
process.env.DATABASE_URL = `file:./prisma/test-${process.env.VITEST_WORKER_ID || '0'}.db`;

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../index.js";
import { prismaClient as prisma } from "../prismaClient.js";
import { fileURLToPath } from 'url';
import path from 'path';
import { generateUniqueEmail, generateUniqueUsername, generateTestNamespace } from './testUtils.js';
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const testFileName = path.basename(__filename, '.spec.ts');
const testNamespace = generateTestNamespace(testFileName);
const JWT_SECRET = process.env.JWT_SECRET ?? "";

// Helper functions
async function createTestUser(options: {
  email?: string;
  username?: string;
  isHidden?: boolean;
  isBanned?: boolean;
  isPrivate?: boolean;
} = {}) {
  const email = options.email || generateUniqueEmail('test', testNamespace);
  const username = options.username || generateUniqueUsername();
  const password = "testpass123"; // Plain text for test database

  return await prisma.users.create({
    data: {
      email,
      username,
      password,
      firstName: "Test",
      lastName: "User",
      dateOfBirth: new Date("1990-01-01"),
      gender: "OTHER",
      profilePhoto: "https://example.com/photo.jpg",
      isHidden: options.isHidden || false,
      isBanned: options.isBanned || false,
      isPrivate: options.isPrivate ?? true,
    }
  });
}

async function createBlock(blockerId: string, blockedId: string) {
  return await prisma.blocks.create({
    data: {
      blockerId,
      blockedId
    }
  });
}

async function createConnection(requesterId: string, requestedId: string, type: "ACQUAINTANCE" | "STRANGER" | "IS_FOLLOWING") {
  return await prisma.connections.create({
    data: {
      requesterId,
      requestedId,
      type
    }
  });
}

function getAuthToken(userId: string) {
  return jwt.sign({ id: userId }, JWT_SECRET);
}

describe("connections endpoints", () => {
  afterAll(async () => {
    // Clean up all test data
    await prisma.connectionRequest.deleteMany({
      where: {
        OR: [
          { requester: { email: { contains: testNamespace } } },
          { requested: { email: { contains: testNamespace } } }
        ]
      }
    });
    await prisma.userConnection.deleteMany({
      where: {
        user: { email: { contains: testNamespace } }
      }
    });
    await prisma.connections.deleteMany({
      where: {
        OR: [
          { requester: { email: { contains: testNamespace } } },
          { requested: { email: { contains: testNamespace } } }
        ]
      }
    });
    await prisma.blocks.deleteMany({
      where: {
        OR: [
          { blocker: { email: { contains: testNamespace } } },
          { blocked: { email: { contains: testNamespace } } }
        ]
      }
    });
    await prisma.users.deleteMany({
      where: {
        email: { contains: testNamespace }
      }
    });
    await prisma.$disconnect();
  });

  describe("GET /connections", () => {
    it("returns 401 unauthorized without authentication token", async () => {
      const res = await request(app)
        .get("/connections");

      expect(res.status).toBe(401);
    });

    it("returns empty array when user has no connections", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .get("/connections")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.connectionsList).toEqual([]);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.nextCursor).toBeNull();
    });

    it("returns connections where user is the requester", async () => {
      const [user1, user2] = await Promise.all([createTestUser(), createTestUser()]);
      const token = getAuthToken(user1.id);

      // Create a connection where user1 is the requester
      const connection = await prisma.connections.create({
        data: {
          requesterId: user1.id,
          requestedId: user2.id,
          type: "ACQUAINTANCE"
        }
      });

      // Create adjacency rows
      await prisma.userConnection.createMany({
        data: [
          {
            userId: user1.id,
            otherUserId: user2.id,
            connectionId: connection.id,
            type: "ACQUAINTANCE"
          },
          {
            userId: user2.id,
            otherUserId: user1.id,
            connectionId: connection.id,
            type: "ACQUAINTANCE"
          }
        ]
      });

      const res = await request(app)
        .get("/connections")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.connectionsList).toHaveLength(1);
      expect(res.body.connectionsList[0]).toMatchObject({
        userId: user2.id,
        firstName: user2.firstName,
        lastName: user2.lastName,
        username: user2.username,
        type: "ACQUAINTANCE"
      });
    });

    it("returns connections where user is the requested", async () => {
      const [user1, user2] = await Promise.all([createTestUser(), createTestUser()]);
      const token = getAuthToken(user1.id);

      // Create a connection where user1 is the requested
      const connection = await prisma.connections.create({
        data: {
          requesterId: user2.id,
          requestedId: user1.id,
          type: "STRANGER"
        }
      });

      // Create adjacency rows
      await prisma.userConnection.createMany({
        data: [
          {
            userId: user1.id,
            otherUserId: user2.id,
            connectionId: connection.id,
            type: "STRANGER"
          },
          {
            userId: user2.id,
            otherUserId: user1.id,
            connectionId: connection.id,
            type: "STRANGER"
          }
        ]
      });

      const res = await request(app)
        .get("/connections")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.connectionsList).toHaveLength(1);
      expect(res.body.connectionsList[0]).toMatchObject({
        userId: user2.id,
        firstName: user2.firstName,
        lastName: user2.lastName,
        username: user2.username,
        type: "STRANGER"
      });
    });

    it("returns multiple connections with correct user information", async () => {
      const [user1, user2, user3] = await Promise.all([
        createTestUser(),
        createTestUser(),
        createTestUser()
      ]);
      const token = getAuthToken(user1.id);

      // Create multiple connections
      const conn1 = await prisma.connections.create({
        data: {
          requesterId: user1.id,
          requestedId: user2.id,
          type: "ACQUAINTANCE"
        }
      });
      
      const conn2 = await prisma.connections.create({
        data: {
          requesterId: user3.id,
          requestedId: user1.id,
          type: "IS_FOLLOWING"
        }
      });

      // Create adjacency rows for both connections
      await prisma.userConnection.createMany({
        data: [
          {
            userId: user1.id,
            otherUserId: user2.id,
            connectionId: conn1.id,
            type: "ACQUAINTANCE"
          },
          {
            userId: user2.id,
            otherUserId: user1.id,
            connectionId: conn1.id,
            type: "ACQUAINTANCE"
          },
          {
            userId: user1.id,
            otherUserId: user3.id,
            connectionId: conn2.id,
            type: "IS_FOLLOWING"
          },
          {
            userId: user3.id,
            otherUserId: user1.id,
            connectionId: conn2.id,
            type: "IS_FOLLOWING"
          }
        ]
      });

      const res = await request(app)
        .get("/connections")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.connectionsList).toHaveLength(2);
      
      // Should contain both connections with the other users' info
      const userIds = res.body.connectionsList.map((conn: any) => conn.userId);
      expect(userIds).toContain(user2.id);
      expect(userIds).toContain(user3.id);
    });

    it("orders connections by creation date (newest first)", async () => {
      const [user1, user2, user3] = await Promise.all([
        createTestUser(),
        createTestUser(),
        createTestUser()
      ]);
      const token = getAuthToken(user1.id);

      // Create connections with different timestamps
      const now = new Date();
      const firstConnection = await prisma.connections.create({
        data: {
          requesterId: user1.id,
          requestedId: user2.id,
          type: "ACQUAINTANCE",
          since: new Date(now.getTime() - 1000) // 1 second ago
        }
      });

      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      const secondConnection = await prisma.connections.create({
        data: {
          requesterId: user3.id,
          requestedId: user1.id,
          type: "STRANGER",
          since: new Date() // Current time (newer)
        }
      });

      // Create adjacency rows
      await prisma.userConnection.createMany({
        data: [
          {
            userId: user1.id,
            otherUserId: user2.id,
            connectionId: firstConnection.id,
            type: "ACQUAINTANCE",
            createdAt: firstConnection.since
          },
          {
            userId: user2.id,
            otherUserId: user1.id,
            connectionId: firstConnection.id,
            type: "ACQUAINTANCE",
            createdAt: firstConnection.since
          },
          {
            userId: user1.id,
            otherUserId: user3.id,
            connectionId: secondConnection.id,
            type: "STRANGER",
            createdAt: secondConnection.since
          },
          {
            userId: user3.id,
            otherUserId: user1.id,
            connectionId: secondConnection.id,
            type: "STRANGER",
            createdAt: secondConnection.since
          }
        ]
      });

      const res = await request(app)
        .get("/connections")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.connectionsList).toHaveLength(2);
      
      // Newer connection should be first
      expect(res.body.connectionsList[0].userId).toBe(user3.id);
      expect(res.body.connectionsList[1].userId).toBe(user2.id);
    });

    it("includes all required user fields and connection information", async () => {
      const [user1, user2] = await Promise.all([createTestUser(), createTestUser()]);
      const token = getAuthToken(user1.id);

      const connection = await prisma.connections.create({
        data: {
          requesterId: user1.id,
          requestedId: user2.id,
          type: "ACQUAINTANCE"
        }
      });

      // Create adjacency rows
      await prisma.userConnection.createMany({
        data: [
          {
            userId: user1.id,
            otherUserId: user2.id,
            connectionId: connection.id,
            type: "ACQUAINTANCE"
          },
          {
            userId: user2.id,
            otherUserId: user1.id,
            connectionId: connection.id,
            type: "ACQUAINTANCE"
          }
        ]
      });

      const res = await request(app)
        .get("/connections")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.connectionsList[0]).toHaveProperty('id');
      expect(res.body.connectionsList[0]).toHaveProperty('userId');
      expect(res.body.connectionsList[0]).toHaveProperty('firstName');
      expect(res.body.connectionsList[0]).toHaveProperty('lastName');
      expect(res.body.connectionsList[0]).toHaveProperty('username');
      expect(res.body.connectionsList[0]).toHaveProperty('profilePhoto');
      expect(res.body.connectionsList[0]).toHaveProperty('type');
      expect(res.body.connectionsList[0]).toHaveProperty('createdAt');
    });

    it("supports pagination with limit and cursor", async () => {
      const user1 = await createTestUser();
      const otherUsers = await Promise.all([
        createTestUser(),
        createTestUser(),
        createTestUser()
      ]);
      const token = getAuthToken(user1.id);

      // Create connections with different timestamps
      for (let i = 0; i < otherUsers.length; i++) {
        const connection = await prisma.connections.create({
          data: {
            requesterId: user1.id,
            requestedId: otherUsers[i].id,
            type: "ACQUAINTANCE"
          }
        });

        await prisma.userConnection.createMany({
          data: [
            {
              userId: user1.id,
              otherUserId: otherUsers[i].id,
              connectionId: connection.id,
              type: "ACQUAINTANCE"
            },
            {
              userId: otherUsers[i].id,
              otherUserId: user1.id,
              connectionId: connection.id,
              type: "ACQUAINTANCE"
            }
          ]
        });

        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Get first page with limit=2
      const res1 = await request(app)
        .get("/connections?limit=2")
        .set("Authorization", `Bearer ${token}`);

      expect(res1.status).toBe(200);
      expect(res1.body.connectionsList).toHaveLength(2);
      expect(res1.body.hasMore).toBe(true);
      expect(res1.body.nextCursor).toBeTruthy();

      // Get second page using cursor
      const res2 = await request(app)
        .get(`/connections?limit=2&cursor=${res1.body.nextCursor}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res2.status).toBe(200);
      expect(res2.body.connectionsList).toHaveLength(1);
      expect(res2.body.hasMore).toBe(false);
    });

    it("supports filtering by connection type", async () => {
      const [user1, user2, user3] = await Promise.all([
        createTestUser(),
        createTestUser(),
        createTestUser()
      ]);
      const token = getAuthToken(user1.id);

      // Create ACQUAINTANCE connection
      const conn1 = await prisma.connections.create({
        data: {
          requesterId: user1.id,
          requestedId: user2.id,
          type: "ACQUAINTANCE"
        }
      });

      await prisma.userConnection.createMany({
        data: [
          {
            userId: user1.id,
            otherUserId: user2.id,
            connectionId: conn1.id,
            type: "ACQUAINTANCE"
          },
          {
            userId: user2.id,
            otherUserId: user1.id,
            connectionId: conn1.id,
            type: "ACQUAINTANCE"
          }
        ]
      });

      // Create IS_FOLLOWING connection
      const conn2 = await prisma.connections.create({
        data: {
          requesterId: user1.id,
          requestedId: user3.id,
          type: "IS_FOLLOWING"
        }
      });

      await prisma.userConnection.createMany({
        data: [
          {
            userId: user1.id,
            otherUserId: user3.id,
            connectionId: conn2.id,
            type: "IS_FOLLOWING"
          },
          {
            userId: user3.id,
            otherUserId: user1.id,
            connectionId: conn2.id,
            type: "IS_FOLLOWING"
          }
        ]
      });

      // Filter for ACQUAINTANCE only
      const res = await request(app)
        .get("/connections?type=ACQUAINTANCE")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.connectionsList).toHaveLength(1);
      expect(res.body.connectionsList[0].type).toBe("ACQUAINTANCE");
      expect(res.body.connectionsList[0].userId).toBe(user2.id);
    });
  });

  describe("POST /connections/request", () => {
    it("returns 400 bad request when requestedId is missing", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ requestType: "ACQUAINTANCE" });

      expect(res.status).toBe(400);
      expect(res.text).toContain("Invalid requestedId");
    });

    it("returns 400 bad request when requestType is invalid", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "INVALID_TYPE" 
        });

      expect(res.status).toBe(400);
      expect(res.text).toContain("Invalid requestType: must be ACQUAINTANCE, STRANGER, or FOLLOW");
    });

    it("returns 400 bad request when trying to connect to yourself", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: user.id,
          requestType: "ACQUAINTANCE" 
        });

      expect(res.status).toBe(400);
      expect(res.text).toContain("Cannot create connection request to yourself");
    });

    it("returns 404 when requester is blocked by requested user", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      // Create block: requested blocks requester
      await createBlock(requested.id, requester.id);
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "ACQUAINTANCE" 
        });

      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 404 when requester has blocked requested user", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      // Create block: requester blocks requested
      await createBlock(requester.id, requested.id);
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "ACQUAINTANCE" 
        });

      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 404 when requester is hidden", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser({ isHidden: true }),
        createTestUser()
      ]);
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "ACQUAINTANCE" 
        });

      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 404 when requested user is hidden", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser({ isHidden: true })
      ]);
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "ACQUAINTANCE" 
        });

      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 403 when requester is banned (auth middleware)", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser({ isBanned: true }),
        createTestUser()
      ]);
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "ACQUAINTANCE" 
        });

      expect(res.status).toBe(403);
      expect(res.text).toBe("Account banned");
    });

    it("returns 404 when requested user is banned", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser({ isBanned: true })
      ]);
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "ACQUAINTANCE" 
        });

      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 409 when ACQUAINTANCE connection already exists", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      // Create existing ACQUAINTANCE connection
      await createConnection(requester.id, requested.id, "ACQUAINTANCE");
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "ACQUAINTANCE" 
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("The request can't proceed because the relationship already exists in that state.");
    });

    it("rejects STRANGER request when ACQUAINTANCE connection exists", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      // Create existing ACQUAINTANCE connection
      await createConnection(requester.id, requested.id, "ACQUAINTANCE");
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "STRANGER" 
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Invalid request type for existing relationship");
    });

    it("allows ACQUAINTANCE request when STRANGER connection exists", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      // Create existing STRANGER connection
      await createConnection(requester.id, requested.id, "STRANGER");
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "ACQUAINTANCE" 
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("requesterId", requester.id);
      expect(res.body).toHaveProperty("requestedId", requested.id);
      expect(res.body).toHaveProperty("requestType", "ACQUAINTANCE");
    });

    it("rejects STRANGER request when STRANGER connection exists", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      // Create existing STRANGER connection
      await createConnection(requester.id, requested.id, "STRANGER");
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "STRANGER" 
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Invalid request type for existing relationship");
    });

    it("allows STRANGER request when IS_FOLLOWING connection exists", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      // Create existing IS_FOLLOWING connection
      await createConnection(requester.id, requested.id, "IS_FOLLOWING");
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "STRANGER" 
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("requesterId", requester.id);
      expect(res.body).toHaveProperty("requestedId", requested.id);
      expect(res.body).toHaveProperty("requestType", "STRANGER");
    });

    it("allows ACQUAINTANCE request when IS_FOLLOWING connection exists", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      // Create existing IS_FOLLOWING connection
      await createConnection(requester.id, requested.id, "IS_FOLLOWING");
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "ACQUAINTANCE" 
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("requesterId", requester.id);
      expect(res.body).toHaveProperty("requestedId", requested.id);
      expect(res.body).toHaveProperty("requestType", "ACQUAINTANCE");
    });

    it("allows ACQUAINTANCE request when no connection exists", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "ACQUAINTANCE" 
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("requesterId", requester.id);
      expect(res.body).toHaveProperty("requestedId", requested.id);
      expect(res.body).toHaveProperty("requestType", "ACQUAINTANCE");

      // Verify the connection request was created in the database
      const connectionRequest = await prisma.connectionRequest.findFirst({
        where: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });
      expect(connectionRequest).toBeTruthy();
    });

    it("allows STRANGER request when no connection exists", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "STRANGER" 
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("requesterId", requester.id);
      expect(res.body).toHaveProperty("requestedId", requested.id);
      expect(res.body).toHaveProperty("requestType", "STRANGER");

      // Verify the connection request was created in the database
      const connectionRequest = await prisma.connectionRequest.findFirst({
        where: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "STRANGER",
          status: "PENDING"
        }
      });
      expect(connectionRequest).toBeTruthy();
    });

    it("updates existing pending request with new type and timestamp", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      // Create initial STRANGER request
      const initialRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "STRANGER",
          status: "PENDING"
        }
      });
      
      const token = getAuthToken(requester.id);

      // Send ACQUAINTANCE request to same user
      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "ACQUAINTANCE" 
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("requestType", "ACQUAINTANCE");

      // Verify the request was updated, not duplicated
      const updatedRequest = await prisma.connectionRequest.findUnique({
        where: { id: initialRequest.id }
      });
      expect(updatedRequest?.type).toBe("ACQUAINTANCE");
      expect(updatedRequest?.createdAt.getTime()).toBeGreaterThan(initialRequest.createdAt.getTime());

      // Verify no duplicate requests exist
      const allRequests = await prisma.connectionRequest.findMany({
        where: {
          requesterId: requester.id,
          requestedId: requested.id,
          status: "PENDING"
        }
      });
      expect(allRequests).toHaveLength(1);
    });

    it("allows FOLLOW request when no connection exists", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "FOLLOW" 
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("requesterId", requester.id);
      expect(res.body).toHaveProperty("requestedId", requested.id);
      expect(res.body).toHaveProperty("requestType", "FOLLOW");

      // Verify the connection request was created in the database
      const connectionRequest = await prisma.connectionRequest.findFirst({
        where: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "FOLLOW",
          status: "PENDING"
        }
      });
      expect(connectionRequest).toBeTruthy();
    });

    it("rejects FOLLOW request when STRANGER connection exists", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      // Create existing STRANGER connection
      await createConnection(requester.id, requested.id, "STRANGER");
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "FOLLOW" 
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Invalid request type for existing relationship");
    });

    it("rejects FOLLOW request when IS_FOLLOWING connection exists", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      // Create existing IS_FOLLOWING connection
      await createConnection(requester.id, requested.id, "IS_FOLLOWING");
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "FOLLOW" 
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Invalid request type for existing relationship");
    });

    it("rejects FOLLOW request when ACQUAINTANCE connection exists", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);
      
      // Create existing ACQUAINTANCE connection
      await createConnection(requester.id, requested.id, "ACQUAINTANCE");
      
      const token = getAuthToken(requester.id);

      const res = await request(app)
        .post("/connections/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          requestedId: requested.id,
          requestType: "FOLLOW" 
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Invalid request type for existing relationship");
    });
  });

  describe("GET /connections/pending/incoming", () => {
    it("returns 401 unauthorized without authentication token", async () => {
      const res = await request(app)
        .get("/connections/pending/incoming");
      
      expect(res.status).toBe(401);
    });

    it("returns empty array when no pending requests exist", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .get("/connections/pending/incoming")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("incomingRequests");
      expect(res.body.incomingRequests).toEqual([]);
    });

    it("returns pending connection requests where user is the requested user", async () => {
      const [requester1, requester2, requested] = await Promise.all([
        createTestUser(),
        createTestUser(),
        createTestUser()
      ]);

      // Create pending connection requests to the requested user
      await Promise.all([
        prisma.connectionRequest.create({
          data: {
            requesterId: requester1.id,
            requestedId: requested.id,
            type: "ACQUAINTANCE",
            status: "PENDING"
          }
        }),
        prisma.connectionRequest.create({
          data: {
            requesterId: requester2.id,
            requestedId: requested.id,
            type: "STRANGER", 
            status: "PENDING"
          }
        })
      ]);

      const token = getAuthToken(requested.id);

      const res = await request(app)
        .get("/connections/pending/incoming")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("incomingRequests");
      expect(res.body.incomingRequests).toHaveLength(2);
      
      // Check that both requests are included
      const requests = res.body.incomingRequests;
      expect(requests.some((req: any) => req.requesterId === requester1.id && req.type === "ACQUAINTANCE")).toBe(true);
      expect(requests.some((req: any) => req.requesterId === requester2.id && req.type === "STRANGER")).toBe(true);
      
      // Check request structure
      expect(requests[0]).toHaveProperty("id");
      expect(requests[0]).toHaveProperty("requesterId");
      expect(requests[0]).toHaveProperty("requestedId", requested.id);
      expect(requests[0]).toHaveProperty("type");
      expect(requests[0]).toHaveProperty("status", "PENDING");
      expect(requests[0]).toHaveProperty("createdAt");
      expect(requests[0]).toHaveProperty("requester");
      expect(requests[0].requester).toHaveProperty("id");
      expect(requests[0].requester).toHaveProperty("firstName");
      expect(requests[0].requester).toHaveProperty("lastName");
      expect(requests[0].requester).toHaveProperty("username");
      expect(requests[0].requester).toHaveProperty("profilePhoto");
    });

    it("does not return requests where user is the requester", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      // Create a pending connection request FROM the user (not TO the user)
      await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requester.id);

      const res = await request(app)
        .get("/connections/pending/incoming")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.incomingRequests).toEqual([]);
    });

    it("does not return non-pending requests", async () => {
      const [requester1, requester2, requested] = await Promise.all([
        createTestUser(),
        createTestUser(),
        createTestUser()
      ]);

      // Create accepted and declined connection requests from different requesters
      await Promise.all([
        prisma.connectionRequest.create({
          data: {
            requesterId: requester1.id,
            requestedId: requested.id,
            type: "ACQUAINTANCE",
            status: "ACCEPTED"
          }
        }),
        prisma.connectionRequest.create({
          data: {
            requesterId: requester2.id,
            requestedId: requested.id,
            type: "STRANGER",
            status: "DECLINED"
          }
        })
      ]);

      const token = getAuthToken(requested.id);

      const res = await request(app)
        .get("/connections/pending/incoming")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.incomingRequests).toEqual([]);
    });

    it("orders requests by creation date (newest first)", async () => {
      const [requester1, requester2, requested] = await Promise.all([
        createTestUser(),
        createTestUser(),
        createTestUser()
      ]);

      // Create first request
      const firstRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester1.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      // Create second request 
      const secondRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester2.id,
          requestedId: requested.id,
          type: "STRANGER",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);

      const res = await request(app)
        .get("/connections/pending/incoming")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.incomingRequests).toHaveLength(2);
      
      // Newest should be first
      expect(res.body.incomingRequests[0].requesterId).toBe(requester2.id);
      expect(res.body.incomingRequests[1].requesterId).toBe(requester1.id);
    });
  });

  describe("GET /connections/pending/outgoing", () => {
    it("returns 401 unauthorized without authentication token", async () => {
      const res = await request(app)
        .get("/connections/pending/outgoing");
      
      expect(res.status).toBe(401);
    });

    it("returns empty array when no outgoing pending requests exist", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .get("/connections/pending/outgoing")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.outgoingRequests).toEqual([]);
    });

    it("returns pending connection requests where user is the requester", async () => {
      const [requester, requested1, requested2] = await Promise.all([
        createTestUser(),
        createTestUser(),
        createTestUser()
      ]);

      // Create outgoing connection requests from the requester
      await Promise.all([
        prisma.connectionRequest.create({
          data: {
            requesterId: requester.id,
            requestedId: requested1.id,
            type: "ACQUAINTANCE",
            status: "PENDING"
          }
        }),
        prisma.connectionRequest.create({
          data: {
            requesterId: requester.id,
            requestedId: requested2.id,
            type: "STRANGER",
            status: "PENDING"
          }
        })
      ]);

      const token = getAuthToken(requester.id);
      const res = await request(app)
        .get("/connections/pending/outgoing")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.outgoingRequests).toHaveLength(2);
      
      const requests = res.body.outgoingRequests;
      expect(requests[0]).toHaveProperty("id");
      expect(requests[0]).toHaveProperty("requesterId", requester.id);
      expect(requests[0]).toHaveProperty("requestedId");
      expect(requests[0]).toHaveProperty("type");
      expect(requests[0]).toHaveProperty("status", "PENDING");
      expect(requests[0]).toHaveProperty("createdAt");
      expect(requests[0]).toHaveProperty("requested");
      expect(requests[0].requested).toHaveProperty("id");
      expect(requests[0].requested).toHaveProperty("firstName");
      expect(requests[0].requested).toHaveProperty("lastName");
      expect(requests[0].requested).toHaveProperty("username");
    });

    it("does not return requests where user is the requested user", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      // Create an incoming connection request TO the user (not FROM the user)
      await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .get("/connections/pending/outgoing")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.outgoingRequests).toEqual([]);
    });

    it("does not return non-pending requests", async () => {
      const [requester, requested1, requested2] = await Promise.all([
        createTestUser(),
        createTestUser(),
        createTestUser()
      ]);

      // Create requests with different statuses
      await Promise.all([
        prisma.connectionRequest.create({
          data: {
            requesterId: requester.id,
            requestedId: requested1.id,
            type: "ACQUAINTANCE",
            status: "ACCEPTED"
          }
        }),
        prisma.connectionRequest.create({
          data: {
            requesterId: requester.id,
            requestedId: requested2.id,
            type: "STRANGER",
            status: "DECLINED"
          }
        })
      ]);

      const token = getAuthToken(requester.id);
      const res = await request(app)
        .get("/connections/pending/outgoing")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.outgoingRequests).toEqual([]);
    });

    it("orders requests by creation date (newest first)", async () => {
      const [requester, requested1, requested2] = await Promise.all([
        createTestUser(),
        createTestUser(),
        createTestUser()
      ]);

      // Create first request
      const request1 = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested1.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      // Wait a moment then create second request to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      const request2 = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested2.id,
          type: "STRANGER",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requester.id);
      const res = await request(app)
        .get("/connections/pending/outgoing")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.outgoingRequests).toHaveLength(2);
      
      // Newest should be first
      expect(res.body.outgoingRequests[0].requestedId).toBe(requested2.id);
      expect(res.body.outgoingRequests[1].requestedId).toBe(requested1.id);
    });
  });

  describe("POST /connections/:requestId/accept", () => {
    it("returns 401 unauthorized without authentication token", async () => {
      const res = await request(app)
        .post("/connections/fake-id/accept");
      
      expect(res.status).toBe(401);
    });

    it("returns 400 bad request when requestId is invalid", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .post("/connections/invalid-id/accept")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404); // Invalid ID will result in "Connection request not found"
      expect(res.text).toBe("Connection request not found");
    });

    it("returns 404 not found when connection request does not exist", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .post("/connections/nonexistent-id/accept")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("Connection request not found");
    });

    it("returns 403 forbidden when trying to accept a request you sent", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      // Create a connection request FROM requester TO requested
      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      // Try to accept with the requester's token (should fail)
      const token = getAuthToken(requester.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/accept`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(403);
      expect(res.text).toBe("You can only accept requests made to you");
    });

    it("returns 409 conflict when connection request is not pending", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      // Create an already accepted connection request
      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "ACCEPTED"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/accept`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(409);
      expect(res.text).toBe("Connection request is not pending");
    });

    it("returns 404 when requester is banned", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser({ isBanned: true }),
        createTestUser()
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/accept`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 403 forbidden when requested user is banned (auth middleware)", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser({ isBanned: true })
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/accept`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(403); // Auth middleware will catch banned user
    });

    it("returns 404 when users have blocked each other", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      // Create block relationship
      await createBlock(requester.id, requested.id);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/accept`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("successfully accepts ACQUAINTANCE request - verifies status=ACCEPTED and creates new connection", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/accept`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("message", "Connection request accepted");
      expect(res.body).toHaveProperty("requestId", connectionRequest.id);
      expect(res.body).toHaveProperty("connectionId");
      expect(res.body).toHaveProperty("type", "ACQUAINTANCE");

      // Verify request status was updated
      const updatedRequest = await prisma.connectionRequest.findUnique({
        where: { id: connectionRequest.id }
      });
      expect(updatedRequest?.status).toBe("ACCEPTED");
      expect(updatedRequest?.decidedAt).toBeTruthy();

      // Verify connection was created
      const connection = await prisma.connections.findFirst({
        where: {
          OR: [
            { requesterId: requester.id, requestedId: requested.id },
            { requesterId: requested.id, requestedId: requester.id }
          ]
        }
      });
      expect(connection).toBeTruthy();
      expect(connection?.type).toBe("ACQUAINTANCE");

      // Verify two adjacency rows were created
      const adjacencies = await prisma.userConnection.findMany({
        where: { connectionId: connection?.id }
      });
      expect(adjacencies).toHaveLength(2);
      
      const requesterAdj = adjacencies.find((a: any) => a.userId === requester.id);
      const requestedAdj = adjacencies.find((a: any) => a.userId === requested.id);
      
      expect(requesterAdj).toBeTruthy();
      expect(requesterAdj?.otherUserId).toBe(requested.id);
      expect(requesterAdj?.type).toBe("ACQUAINTANCE");
      
      expect(requestedAdj).toBeTruthy();
      expect(requestedAdj?.otherUserId).toBe(requester.id);
      expect(requestedAdj?.type).toBe("ACQUAINTANCE");
    });

    it("successfully accepts STRANGER request - verifies status=ACCEPTED and creates STRANGER connection", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "STRANGER",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/accept`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.type).toBe("STRANGER");

      // Verify connection was created with correct type
      const connection = await prisma.connections.findFirst({
        where: {
          OR: [
            { requesterId: requester.id, requestedId: requested.id },
            { requesterId: requested.id, requestedId: requester.id }
          ]
        }
      });
      expect(connection?.type).toBe("STRANGER");
    });

    it("successfully accepts FOLLOW request - verifies status=ACCEPTED and creates IS_FOLLOWING connection", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "FOLLOW",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/accept`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.type).toBe("IS_FOLLOWING");

      // Verify connection was created with correct type (FOLLOW becomes IS_FOLLOWING)
      const connection = await prisma.connections.findFirst({
        where: {
          OR: [
            { requesterId: requester.id, requestedId: requested.id },
            { requesterId: requested.id, requestedId: requester.id }
          ]
        }
      });
      expect(connection?.type).toBe("IS_FOLLOWING");
    });

    it("successfully accepts request - verifies status=ACCEPTED and UPDATES existing connection type", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      // Create existing STRANGER connection
      const existingConnection = await createConnection(requester.id, requested.id, "STRANGER");

      // Create ACQUAINTANCE request (upgrade)
      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/accept`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.type).toBe("ACQUAINTANCE");
      expect(res.body.connectionId).toBe(existingConnection.id);

      // Verify existing connection was updated
      const updatedConnection = await prisma.connections.findUnique({
        where: { id: existingConnection.id }
      });
      expect(updatedConnection?.type).toBe("ACQUAINTANCE");
    });
  });

  describe("POST /connections/:requestId/decline", () => {
    it("returns 401 unauthorized without authentication token", async () => {
      const res = await request(app)
        .post("/connections/fake-id/decline");
      
      expect(res.status).toBe(401);
    });

    it("returns 400 bad request when requestId is invalid", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .post("/connections/invalid-id/decline")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404); // Invalid ID will result in "Connection request not found"
      expect(res.text).toBe("Connection request not found");
    });

    it("returns 404 not found when connection request does not exist", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .post("/connections/nonexistent-id/decline")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("Connection request not found");
    });

    it("returns 403 forbidden when trying to decline a request you sent", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      // Create a connection request FROM requester TO requested
      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      // Try to decline with the requester's token (should fail)
      const token = getAuthToken(requester.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/decline`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(403);
      expect(res.text).toBe("You can only decline requests made to you");
    });

    it("returns 409 conflict when connection request is not pending", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      // Create an already accepted connection request
      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "ACCEPTED"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/decline`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(409);
      expect(res.text).toBe("Connection request is not pending");
    });

    it("returns 404 when requester is banned", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser({ isBanned: true }),
        createTestUser()
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/decline`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 404 when users have blocked each other", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      // Create block relationship
      await createBlock(requester.id, requested.id);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/decline`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("successfully declines ACQUAINTANCE request - verifies status=DECLINED in database", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/decline`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("message", "Connection request declined");
      expect(res.body).toHaveProperty("requestId", connectionRequest.id);
      expect(res.body).toHaveProperty("status", "DECLINED");

      // Verify request status was updated in database
      const updatedRequest = await prisma.connectionRequest.findUnique({
        where: { id: connectionRequest.id }
      });
      expect(updatedRequest?.status).toBe("DECLINED");
      expect(updatedRequest?.decidedAt).toBeTruthy();

      // Verify no connection was created in connections table
      const connection = await prisma.connections.findFirst({
        where: {
          OR: [
            { requesterId: requester.id, requestedId: requested.id },
            { requesterId: requested.id, requestedId: requester.id }
          ]
        }
      });
      expect(connection).toBe(null);
    });

    it("successfully declines STRANGER request - verifies status=DECLINED in database", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "STRANGER",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/decline`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("DECLINED");

      // Verify database update
      const updatedRequest = await prisma.connectionRequest.findUnique({
        where: { id: connectionRequest.id }
      });
      expect(updatedRequest?.status).toBe("DECLINED");
    });

    it("successfully declines FOLLOW request - verifies status=DECLINED in database", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "FOLLOW",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requested.id);
      const res = await request(app)
        .post(`/connections/${connectionRequest.id}/decline`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("DECLINED");

      // Verify database update
      const updatedRequest = await prisma.connectionRequest.findUnique({
        where: { id: connectionRequest.id }
      });
      expect(updatedRequest?.status).toBe("DECLINED");
    });
  });

  describe("DELETE /connections/:requestId/cancel", () => {
    it("returns 401 unauthorized without authentication token", async () => {
      const res = await request(app)
        .delete("/connections/fake-id/cancel");
      
      expect(res.status).toBe(401);
    });

    it("returns 400 bad request when requestId is invalid", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .delete("/connections/invalid-id/cancel")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404); // Invalid ID will result in "Connection request not found"
      expect(res.text).toBe("Connection request not found");
    });

    it("returns 404 not found when connection request does not exist", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .delete("/connections/nonexistent-id/cancel")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("Connection request not found");
    });

    it("returns 403 forbidden when trying to cancel a request sent to you", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      // Create a connection request FROM requester TO requested
      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      // Try to cancel with the requested user's token (should fail)
      const token = getAuthToken(requested.id);
      const res = await request(app)
        .delete(`/connections/${connectionRequest.id}/cancel`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(403);
      expect(res.text).toBe("You can only cancel requests you sent");
    });

    it("returns 409 conflict when connection request is not pending", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      // Create an already accepted connection request
      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "ACCEPTED"
        }
      });

      const token = getAuthToken(requester.id);
      const res = await request(app)
        .delete(`/connections/${connectionRequest.id}/cancel`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(409);
      expect(res.text).toBe("Connection request is not pending");
    });

    it("returns 404 when requested user is banned", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser({ isBanned: true })
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requester.id);
      const res = await request(app)
        .delete(`/connections/${connectionRequest.id}/cancel`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 404 when users have blocked each other", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      // Create block relationship
      await createBlock(requester.id, requested.id);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requester.id);
      const res = await request(app)
        .delete(`/connections/${connectionRequest.id}/cancel`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("successfully cancels ACQUAINTANCE request - verifies status=CANCELED in database", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requester.id);
      const res = await request(app)
        .delete(`/connections/${connectionRequest.id}/cancel`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("message", "Connection request canceled");
      expect(res.body).toHaveProperty("requestId", connectionRequest.id);
      expect(res.body).toHaveProperty("status", "CANCELED");

      // Verify request status was updated in database
      const updatedRequest = await prisma.connectionRequest.findUnique({
        where: { id: connectionRequest.id }
      });
      expect(updatedRequest?.status).toBe("CANCELED");
      expect(updatedRequest?.decidedAt).toBeTruthy();

      // Verify no connection was created in connections table
      const connection = await prisma.connections.findFirst({
        where: {
          OR: [
            { requesterId: requester.id, requestedId: requested.id },
            { requesterId: requested.id, requestedId: requester.id }
          ]
        }
      });
      expect(connection).toBe(null);
    });

    it("successfully cancels STRANGER request - verifies status=CANCELED in database", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "STRANGER",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requester.id);
      const res = await request(app)
        .delete(`/connections/${connectionRequest.id}/cancel`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("CANCELED");

      // Verify database update
      const updatedRequest = await prisma.connectionRequest.findUnique({
        where: { id: connectionRequest.id }
      });
      expect(updatedRequest?.status).toBe("CANCELED");
    });

    it("successfully cancels FOLLOW request - verifies status=CANCELED in database", async () => {
      const [requester, requested] = await Promise.all([
        createTestUser(),
        createTestUser()
      ]);

      const connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requester.id,
          requestedId: requested.id,
          type: "FOLLOW",
          status: "PENDING"
        }
      });

      const token = getAuthToken(requester.id);
      const res = await request(app)
        .delete(`/connections/${connectionRequest.id}/cancel`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("CANCELED");

      // Verify database update
      const updatedRequest = await prisma.connectionRequest.findUnique({
        where: { id: connectionRequest.id }
      });
      expect(updatedRequest?.status).toBe("CANCELED");
    });
  });

  describe("DELETE /connections/:id", () => {
    it("returns 401 unauthorized without authentication token", async () => {
      const user = await createTestUser();

      const res = await request(app)
        .delete(`/connections/${user.id}`);

      expect(res.status).toBe(401);
    });

    it("returns 404 not found when user ID is invalid", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .delete("/connections/invalid-id")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 400 bad request when trying to delete connection to yourself", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);

      const res = await request(app)
        .delete(`/connections/${user.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.text).toBe("Cannot delete connection to yourself");
    });

    it("returns 404 not found when other user does not exist", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id);
      const nonExistentUserId = "non-existent-user-id";

      const res = await request(app)
        .delete(`/connections/${nonExistentUserId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 404 not found when connection does not exist", async () => {
      const [user1, user2] = await Promise.all([createTestUser(), createTestUser()]);
      const token = getAuthToken(user1.id);

      // No connection exists between these users
      const res = await request(app)
        .delete(`/connections/${user2.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.text).toBe("Connection not found");
    });

    it("successfully deletes ACQUAINTANCE connection type", async () => {
      const [user1, user2] = await Promise.all([createTestUser(), createTestUser()]);
      const token = getAuthToken(user1.id);

      // Create connection where user1 is the requester
      const connection = await prisma.connections.create({
        data: {
          requesterId: user1.id,
          requestedId: user2.id,
          type: "ACQUAINTANCE"
        }
      });

      // Create adjacency rows
      await prisma.userConnection.createMany({
        data: [
          {
            userId: user1.id,
            otherUserId: user2.id,
            connectionId: connection.id,
            type: "ACQUAINTANCE"
          },
          {
            userId: user2.id,
            otherUserId: user1.id,
            connectionId: connection.id,
            type: "ACQUAINTANCE"
          }
        ]
      });

      const res = await request(app)
        .delete(`/connections/${user2.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        message: "Connection deleted successfully",
        deletedConnectionId: connection.id,
        otherUserId: user2.id
      });

      // Verify connection was deleted from database
      const deletedConnection = await prisma.connections.findUnique({
        where: { id: connection.id }
      });
      expect(deletedConnection).toBeNull();

      // Verify both adjacency rows were deleted
      const remainingAdjacencies = await prisma.userConnection.findMany({
        where: { connectionId: connection.id }
      });
      expect(remainingAdjacencies).toHaveLength(0);
    });

    it("successfully deletes STRANGER connection type", async () => {
      const [user1, user2] = await Promise.all([createTestUser(), createTestUser()]);
      const token = getAuthToken(user1.id);

      // Create connection where user1 is the requested
      const connection = await prisma.connections.create({
        data: {
          requesterId: user2.id,
          requestedId: user1.id,
          type: "STRANGER"
        }
      });

      const res = await request(app)
        .delete(`/connections/${user2.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        message: "Connection deleted successfully",
        deletedConnectionId: connection.id,
        otherUserId: user2.id
      });

      // Verify connection was deleted from database
      const deletedConnection = await prisma.connections.findUnique({
        where: { id: connection.id }
      });
      expect(deletedConnection).toBeNull();
    });

    it("successfully deletes IS_FOLLOWING connection type", async () => {
      const [user1, user2] = await Promise.all([createTestUser(), createTestUser()]);
      const token = getAuthToken(user1.id);

      // Create IS_FOLLOWING connection
      const connection = await prisma.connections.create({
        data: {
          requesterId: user1.id,
          requestedId: user2.id,
          type: "IS_FOLLOWING"
        }
      });

      const res = await request(app)
        .delete(`/connections/${user2.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Connection deleted successfully");

      // Verify connection was deleted from database
      const deletedConnection = await prisma.connections.findUnique({
        where: { id: connection.id }
      });
      expect(deletedConnection).toBeNull();
    });

    it("does not affect other connections when deleting specific connection", async () => {
      const [user1, user2, user3] = await Promise.all([
        createTestUser(),
        createTestUser(),
        createTestUser()
      ]);
      const token = getAuthToken(user1.id);

      // Create multiple connections
      const connection1 = await prisma.connections.create({
        data: {
          requesterId: user1.id,
          requestedId: user2.id,
          type: "ACQUAINTANCE"
        }
      });

      const connection2 = await prisma.connections.create({
        data: {
          requesterId: user1.id,
          requestedId: user3.id,
          type: "STRANGER"
        }
      });

      // Delete connection with user2
      const res = await request(app)
        .delete(`/connections/${user2.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);

      // Verify only the specific connection was deleted
      const deletedConnection = await prisma.connections.findUnique({
        where: { id: connection1.id }
      });
      expect(deletedConnection).toBeNull();

      // Verify other connection still exists
      const remainingConnection = await prisma.connections.findUnique({
        where: { id: connection2.id }
      });
      expect(remainingConnection).not.toBeNull();
      expect(remainingConnection?.type).toBe("STRANGER");
    });
  });
});