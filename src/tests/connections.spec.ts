import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../index.js";
import { PrismaClient } from "../generated/prisma/index.js";
import { fileURLToPath } from 'url';
import path from 'path';
import { generateUniqueEmail, generateUniqueUsername } from './testUtils.js';
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const testFileName = path.basename(__filename, '.spec.ts');
const testNamespace = `${testFileName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

const prisma = new PrismaClient();
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

function getAuthToken(userId: string, email: string) {
  return jwt.sign({ id: userId, email }, JWT_SECRET);
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

  describe("POST /connections/request", () => {
    it("returns 400 bad request when requestedId is missing", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id, user.email);

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
      const token = getAuthToken(requester.id, requester.email);

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
      const token = getAuthToken(user.id, user.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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
      
      const token = getAuthToken(requester.id, requester.email);

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

  describe("GET /connections/pending", () => {
    it("returns 401 unauthorized without authentication token", async () => {
      const res = await request(app)
        .get("/connections/pending?type=received");
      
      expect(res.status).toBe(401);
    });

    it("returns 400 bad request for invalid type parameter", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id, user.email);

      const res = await request(app)
        .get("/connections/pending?type=invalid")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(400);
      expect(res.text).toBe("Invalid type parameter: must be 'received'");
    });

    it("returns empty array when no pending requests exist", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user.id, user.email);

      const res = await request(app)
        .get("/connections/pending?type=received")
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

      const token = getAuthToken(requested.id, requested.email);

      const res = await request(app)
        .get("/connections/pending?type=received")
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
      expect(requests[0].requester).toHaveProperty("photo");
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

      const token = getAuthToken(requester.id, requester.email);

      const res = await request(app)
        .get("/connections/pending?type=received")
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

      const token = getAuthToken(requested.id, requested.email);

      const res = await request(app)
        .get("/connections/pending?type=received")
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

      const token = getAuthToken(requested.id, requested.email);

      const res = await request(app)
        .get("/connections/pending?type=received")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.incomingRequests).toHaveLength(2);
      
      // Newest should be first
      expect(res.body.incomingRequests[0].requesterId).toBe(requester2.id);
      expect(res.body.incomingRequests[1].requesterId).toBe(requester1.id);
    });
  });
});