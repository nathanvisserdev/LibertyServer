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

// Helper function to create a user and get token
async function createUserAndGetToken(prefix: string) {
  const userEmail = generateUniqueEmail(prefix, testNamespace);
  const userPassword = "testpass123";
  const userUsername = generateUniqueUsername(testNamespace);
  
  const signupRes = await request(app)
    .post("/signup")
    .send({ 
      email: userEmail, 
      password: userPassword,
      firstName: "Test",
      lastName: "User",
      username: userUsername,
      dateOfBirth: "1990-01-01",
      gender: "MALE",
      zipCode: "12345",
      profilePhoto: "photo.jpg",
      isPrivate: false
    });

  if (signupRes.status !== 201) {
    throw new Error(`Signup failed: ${signupRes.status} ${JSON.stringify(signupRes.body)}`);
  }

  const loginRes = await request(app)
    .post("/login")
    .send({ email: userEmail, password: userPassword });

  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }

  // Decode the JWT to get the user ID
  const decoded = jwt.verify(loginRes.body.accessToken, JWT_SECRET) as any;

  return {
    userId: decoded.id,
    token: loginRes.body.accessToken,
  };
}

describe("Subnets API", () => {
  let testUserId: string;
  let testUserToken: string;
  let otherUserId: string;
  let otherUserToken: string;

  beforeAll(async () => {
    // Create test users
    const user1 = await createUserAndGetToken("subnetuser");
    testUserId = user1.userId;
    testUserToken = user1.token;

    const user2 = await createUserAndGetToken("otheruser");
    otherUserId = user2.userId;
    otherUserToken = user2.token;
  });

  afterAll(async () => {
    // Cleanup
    if (testUserId && otherUserId) {
      await prisma.subNet.deleteMany({
        where: {
          ownerId: { in: [testUserId, otherUserId] },
        },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [testUserId, otherUserId] } },
      });
    }
  });

  describe("POST /subnets", () => {
    it("should create a subnet with valid data", async () => {
      const res = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({
          name: generateUniqueString("Work Friends", testNamespace),
          description: "People from work",
          visibility: "PRIVATE",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.name).toContain("Work Friends");
      expect(res.body.slug).toContain("work-friends");
      expect(res.body.description).toBe("People from work");
      expect(res.body.visibility).toBe("PRIVATE");
      expect(res.body.ownerId).toBe(testUserId);
    });

    it("should create subnet with default visibility when not specified", async () => {
      const res = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({
          name: generateUniqueString("Family", testNamespace),
        });

      expect(res.status).toBe(201);
      expect(res.body.visibility).toBe("PRIVATE");
    });

    it("should generate unique slugs for duplicate names", async () => {
      const uniqueName = generateUniqueString("Friends", testNamespace);
      const res1 = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: uniqueName });

      const res2 = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: uniqueName });

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.slug).not.toBe(res2.body.slug);
      expect(res2.body.slug).toMatch(/-\d+$/); // Should end with -1 or higher
    });

    it("should reject request without name", async () => {
      const res = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Name is required");
    });

    it("should reject invalid visibility", async () => {
      const res = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({
          name: "Test",
          visibility: "INVALID",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid visibility");
    });

    it("should create child subnet with valid parent", async () => {
      // Create parent
      const parentRes = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "Parent Subnet" });

      // Create child
      const childRes = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({
          name: "Child Subnet",
          parentId: parentRes.body.id,
        });

      expect(childRes.status).toBe(201);
      expect(childRes.body.parentId).toBe(parentRes.body.id);
    });

    it("should reject parent subnet that doesn't belong to user", async () => {
      // Create subnet owned by other user
      const otherSubnetRes = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${otherUserToken}`)
        .send({ name: "Other User's Subnet" });

      // Try to create child subnet using other user's subnet as parent
      const res = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({
          name: "Child",
          parentId: otherSubnetRes.body.id,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("does not belong to you");
    });
  });

  describe("GET /subnets", () => {
    let subnet1Id: string;
    let subnet2Id: string;

    beforeAll(async () => {
      // Create test subnets
      const s1 = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "List Test 1" });
      subnet1Id = s1.body.id;

      const s2 = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "List Test 2", visibility: "PUBLIC" });
      subnet2Id = s2.body.id;
    });

    it("should list all subnets owned by the user", async () => {
      const res = await request(app)
        .get("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      const ids = res.body.map((s: any) => s.id);
      expect(ids).toContain(subnet1Id);
      expect(ids).toContain(subnet2Id);
    });

    it("should only return subnets owned by authenticated user", async () => {
      const res = await request(app)
        .get("/subnets")
        .set("Authorization", `Bearer ${otherUserToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.map((s: any) => s.id);
      expect(ids).not.toContain(subnet1Id);
      expect(ids).not.toContain(subnet2Id);
    });

    it("should require authentication", async () => {
      const res = await request(app).get("/subnets");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /subnets/:id", () => {
    let subnetId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "Get Test Subnet" });
      subnetId = res.body.id;
    });

    it("should retrieve a subnet by ID", async () => {
      const res = await request(app)
        .get(`/subnets/${subnetId}`)
        .set("Authorization", `Bearer ${testUserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(subnetId);
      expect(res.body.name).toBe("Get Test Subnet");
      expect(res.body).toHaveProperty("owner");
      expect(res.body).toHaveProperty("members");
    });

    it("should not allow other users to view subnet", async () => {
      const res = await request(app)
        .get(`/subnets/${subnetId}`)
        .set("Authorization", `Bearer ${otherUserToken}`);

      expect(res.status).toBe(403);
    });

    it("should return 404 for non-existent subnet", async () => {
      const res = await request(app)
        .get("/subnets/nonexistent")
        .set("Authorization", `Bearer ${testUserToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /subnets/:id", () => {
    let subnetId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "Update Test Subnet" });
      subnetId = res.body.id;
    });

    it("should update subnet name", async () => {
      const res = await request(app)
        .patch(`/subnets/${subnetId}`)
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "Updated Name" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated Name");
      expect(res.body.slug).toBe("updated-name");
    });

    it("should update subnet visibility", async () => {
      const res = await request(app)
        .patch(`/subnets/${subnetId}`)
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ visibility: "PUBLIC" });

      expect(res.status).toBe(200);
      expect(res.body.visibility).toBe("PUBLIC");
    });

    it("should update subnet description", async () => {
      const res = await request(app)
        .patch(`/subnets/${subnetId}`)
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ description: "New description" });

      expect(res.status).toBe(200);
      expect(res.body.description).toBe("New description");
    });

    it("should not allow other users to update subnet", async () => {
      const res = await request(app)
        .patch(`/subnets/${subnetId}`)
        .set("Authorization", `Bearer ${otherUserToken}`)
        .send({ name: "Hacked" });

      expect(res.status).toBe(403);
    });

    it("should prevent circular hierarchy", async () => {
      // Create parent and child
      const parentRes = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "Parent" });

      const childRes = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "Child", parentId: parentRes.body.id });

      // Try to make parent a child of child (circular)
      const res = await request(app)
        .patch(`/subnets/${parentRes.body.id}`)
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ parentId: childRes.body.id });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("circular");
    });

    it("should prevent subnet from being its own parent", async () => {
      const res = await request(app)
        .patch(`/subnets/${subnetId}`)
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ parentId: subnetId });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("own parent");
    });
  });

  describe("DELETE /subnets/:id", () => {
    it("should delete a subnet", async () => {
      // Create subnet to delete
      const createRes = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "To Delete" });

      const subnetId = createRes.body.id;

      // Delete it
      const deleteRes = await request(app)
        .delete(`/subnets/${subnetId}`)
        .set("Authorization", `Bearer ${testUserToken}`);

      expect(deleteRes.status).toBe(204);

      // Verify it's deleted
      const getRes = await request(app)
        .get(`/subnets/${subnetId}`)
        .set("Authorization", `Bearer ${testUserToken}`);

      expect(getRes.status).toBe(404);
    });

    it("should not allow other users to delete subnet", async () => {
      const createRes = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "Protected" });

      const res = await request(app)
        .delete(`/subnets/${createRes.body.id}`)
        .set("Authorization", `Bearer ${otherUserToken}`);

      expect(res.status).toBe(403);
    });

    it("should prevent deletion of subnet with children", async () => {
      // Create parent and child
      const parentRes = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "Parent with Children" });

      await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "Child", parentId: parentRes.body.id });

      // Try to delete parent
      const res = await request(app)
        .delete(`/subnets/${parentRes.body.id}`)
        .set("Authorization", `Bearer ${testUserToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("child subnets");
    });

    it("should prevent deletion of default subnet", async () => {
      // Create subnet and set as default
      const createRes = await request(app)
        .post("/subnets")
        .set("Authorization", `Bearer ${testUserToken}`)
        .send({ name: "Default Subnet" });

      const subnetId = createRes.body.id;

      // Set as default
      await prisma.user.update({
        where: { id: testUserId },
        data: { defaultSubNetId: subnetId },
      });

      // Try to delete
      const res = await request(app)
        .delete(`/subnets/${subnetId}`)
        .set("Authorization", `Bearer ${testUserToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("default");

      // Cleanup: remove default
      await prisma.user.update({
        where: { id: testUserId },
        data: { defaultSubNetId: null },
      });
    });

    it("should return 404 for non-existent subnet", async () => {
      const res = await request(app)
        .delete("/subnets/nonexistent")
        .set("Authorization", `Bearer ${testUserToken}`);

      expect(res.status).toBe(404);
    });
  });
});
