import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../index.js";
import { PrismaClient } from "../generated/prisma/index.js";
import { fileURLToPath } from 'url';
import path from 'path';
import { generateUniqueEmail, generateUniqueUsername } from './testUtils.js';

const __filename = fileURLToPath(import.meta.url);
const testFileName = path.basename(__filename, '.spec.ts');
const testNamespace = `${testFileName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

const prisma = new PrismaClient();

// Helper function to create a user and get token
async function createUserAndGetToken(isPaid?: boolean, email?: string, password?: string, username?: string) {
  const userEmail = email || generateUniqueEmail('test', testNamespace);
  const userPassword = password || "testpass123";
  const userUsername = username || generateUniqueUsername();
  
  const signupRes = await request(app)
    .post("/signup")
    .send({ 
      email: userEmail, 
      password: userPassword,
      firstName: "Test",
      lastName: "User",
      username: userUsername
    });
  
  // Validate signup response
  if (signupRes.status !== 201 || !signupRes.body || !signupRes.body.id) {
    throw new Error(`Signup failed: ${JSON.stringify(signupRes.body)} (status: ${signupRes.status})`);
  }
  
  // If isPaid is true, update the user to be paid
  if (isPaid) {
    await prisma.users.update({
      where: { id: signupRes.body.id },
      data: { isPaid: true }
    });
  }
  
  const loginRes = await request(app)
    .post("/login")
    .send({ email: userEmail, password: userPassword });
  
  return {
    userId: signupRes.body.id,
    token: loginRes.body.accessToken,
    email: userEmail,
    password: userPassword,
    username: userUsername
  };
}

describe("groups endpoints", () => {
  // Clean up test data after all tests complete
  afterAll(async () => {
    // Only delete test users created by this test file
    await prisma.users.deleteMany({
      where: {
        email: {
          contains: testNamespace
        }
      }
    });
    await prisma.$disconnect();
  });

  describe("POST /groups", () => {
    it("successfully creates a PUBLIC group for unpaid user", async () => {
      const { token, userId } = await createUserAndGetToken(false);
      const groupName = `Test Public Group ${Date.now()}`;
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: groupName, 
          groupType: "PUBLIC",
          description: "A test public group"
        });
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("name", groupName);
      expect(res.body).toHaveProperty("groupType", "PUBLIC");
      expect(res.body).toHaveProperty("isHidden", false);
    });

    it("successfully creates a PRIVATE group for unpaid user", async () => {
      const { token, userId } = await createUserAndGetToken(false);
      const groupName = `Test Private Group ${Date.now()}`;
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: groupName, 
          groupType: "PRIVATE",
          description: "A test private group"
        });
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("name", groupName);
      expect(res.body).toHaveProperty("groupType", "PRIVATE");
      expect(res.body).toHaveProperty("isHidden", false);
    });

    it("defaults isHidden to false when not specified", async () => {
      const { token } = await createUserAndGetToken(false);
      const groupName = `Default Group ${Date.now()}`;
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: groupName, 
          groupType: "PUBLIC"
        });
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("isHidden", false);
    });

    it("ignores isHidden: false for unpaid users", async () => {
      const { token } = await createUserAndGetToken(false);
      const groupName = `Ignore Hidden False ${Date.now()}`;
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: groupName, 
          groupType: "PUBLIC",
          isHidden: false // Should be ignored/allowed
        });
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("isHidden", false);
    });

    it("rejects isHidden: true for unpaid users with 402", async () => {
      const { token } = await createUserAndGetToken(false);
      const groupName = `Hidden Group ${Date.now()}`;
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: groupName, 
          groupType: "PRIVATE",
          isHidden: true // Should be rejected
        });
      
      expect(res.status).toBe(402);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toContain("Premium membership required");
    });

    it("validates required name field", async () => {
      const { token } = await createUserAndGetToken(false);
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          groupType: "PUBLIC"
          // Missing name
        });
      
      expect(res.status).toBe(400);
    });

    it("validates groupType field", async () => {
      const { token } = await createUserAndGetToken(false);
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: `Test Group ${Date.now()}`,
          groupType: "INVALID"
        });
      
      expect(res.status).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await request(app)
        .post("/groups")
        .send({ 
          name: `Test Group ${Date.now()}`,
          groupType: "PUBLIC"
        });
      
      expect(res.status).toBe(401);
    });

    it("handles case-insensitive groupType", async () => {
      const { token } = await createUserAndGetToken(false);
      const groupName = `Case Test Group ${Date.now()}`;
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: groupName, 
          groupType: "public" // lowercase
        });
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("groupType", "PUBLIC"); // should be uppercase in response
    });

    it("converts name to string", async () => {
      const { token } = await createUserAndGetToken(false);
      const groupNumber = Date.now();
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: groupNumber, // number instead of string
          groupType: "PUBLIC"
        });
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("name", String(groupNumber));
    });

    it("allows special characters in group name", async () => {
      const { token } = await createUserAndGetToken(false);
      const groupName = `Test Group 🚀 Special & Chars ${Date.now()}`;
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: groupName, 
          groupType: "PUBLIC"
        });
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("name", groupName);
    });

    it("handles empty description gracefully", async () => {
      const { token } = await createUserAndGetToken(false);
      const groupName = `Empty Desc Group ${Date.now()}`;
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: groupName, 
          groupType: "PUBLIC",
          description: ""
        });
      
      expect(res.status).toBe(201);
    });

    // Tests for paid users
    it("allows paid users to create hidden groups", async () => {
      const { token } = await createUserAndGetToken(true); // Create paid user
      const groupName = `Hidden Group ${Date.now()}`;
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: groupName, 
          groupType: "PRIVATE",
          isHidden: true // Should be allowed for paid users
        });
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("name", groupName);
      expect(res.body).toHaveProperty("groupType", "PRIVATE");
      expect(res.body).toHaveProperty("isHidden", true);
    });

    it("allows paid users to create non-hidden groups", async () => {
      const { token } = await createUserAndGetToken(true); // Create paid user
      const groupName = `Public Group from Paid User ${Date.now()}`;
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: groupName, 
          groupType: "PUBLIC",
          isHidden: false // Explicitly set to false
        });
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("isHidden", false);
    });

    it("defaults to non-hidden for paid users when isHidden not specified", async () => {
      const { token } = await createUserAndGetToken(true); // Create paid user
      const groupName = `Default Group from Paid User ${Date.now()}`;
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: groupName, 
          groupType: "PUBLIC"
          // isHidden not specified
        });
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("isHidden", false);
    });
  });

  describe("GET /groups", () => {
    it("returns visible groups for unpaid user", async () => {
      const { token } = await createUserAndGetToken(false);
      
      // Create a public group
      await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: `Public Group ${Date.now()}`, 
          groupType: "PUBLIC"
        });

      const res = await request(app)
        .get("/groups")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      
      // Should include the public group and user's personal "Social Circle"
      const publicGroups = res.body.filter((g: any) => g.groupType === "PUBLIC");
      const personalGroups = res.body.filter((g: any) => g.groupType === "PERSONAL");
      
      expect(publicGroups.length).toBeGreaterThan(0);
      expect(personalGroups.length).toBeGreaterThan(0); // User's own Social Circle
    });

    it("filters out hidden groups for non-members", async () => {
      const { token: paidToken } = await createUserAndGetToken(true); // Paid user to create hidden group
      const { token: unpaidToken } = await createUserAndGetToken(false); // Unpaid user to test filtering

      // Create a hidden group with paid user
      const hiddenGroupRes = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${paidToken}`)
        .send({ 
          name: `Hidden Group ${Date.now()}`, 
          groupType: "PRIVATE",
          isHidden: true
        });
      
      expect(hiddenGroupRes.status).toBe(201);

      // Unpaid user should not see the hidden group
      const res = await request(app)
        .get("/groups")
        .set("Authorization", `Bearer ${unpaidToken}`);
      
      expect(res.status).toBe(200);
      
      const hiddenGroups = res.body.filter((g: any) => g.isHidden === true);
      expect(hiddenGroups.length).toBe(0); // Should not see any hidden groups
    });

    it("shows hidden groups to their admins", async () => {
      const { token } = await createUserAndGetToken(true); // Paid user

      // Create a hidden group
      const hiddenGroupRes = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: `Admin Hidden Group ${Date.now()}`, 
          groupType: "PRIVATE",
          isHidden: true
        });
      
      expect(hiddenGroupRes.status).toBe(201);
      const groupId = hiddenGroupRes.body.id;

      // Admin should see their own hidden group
      const res = await request(app)
        .get("/groups")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      
      const foundHiddenGroup = res.body.find((g: any) => g.id === groupId);
      expect(foundHiddenGroup).toBeDefined();
      expect(foundHiddenGroup.isHidden).toBe(true);
    });

    it("shows hidden groups to their members", async () => {
      const { token: adminToken } = await createUserAndGetToken(true); // Paid admin
      const { token: memberToken, userId: memberId } = await createUserAndGetToken(false); // Member

      // Create a hidden group with admin
      const hiddenGroupRes = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ 
          name: `Member Hidden Group ${Date.now()}`, 
          groupType: "PRIVATE",
          isHidden: true
        });
      
      expect(hiddenGroupRes.status).toBe(201);
      const groupId = hiddenGroupRes.body.id;

      // Add member to the hidden group (simulating joining)
      await prisma.groupRoster.create({
        data: {
          userId: memberId,
          groupId: groupId
        }
      });

      // Member should see the hidden group they belong to
      const res = await request(app)
        .get("/groups")
        .set("Authorization", `Bearer ${memberToken}`);
      
      expect(res.status).toBe(200);
      
      const foundHiddenGroup = res.body.find((g: any) => g.id === groupId);
      expect(foundHiddenGroup).toBeDefined();
      expect(foundHiddenGroup.isHidden).toBe(true);
    });

    it("filters out other users' PERSONAL groups", async () => {
      const { token: token1 } = await createUserAndGetToken(false);
      const { token: token2 } = await createUserAndGetToken(false);

      // Get groups for first user
      const res1 = await request(app)
        .get("/groups")
        .set("Authorization", `Bearer ${token1}`);
      
      // Get groups for second user  
      const res2 = await request(app)
        .get("/groups")
        .set("Authorization", `Bearer ${token2}`);
      
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const personalGroups1 = res1.body.filter((g: any) => g.groupType === "PERSONAL");
      const personalGroups2 = res2.body.filter((g: any) => g.groupType === "PERSONAL");

      // Each user should only see their own personal group
      expect(personalGroups1.length).toBe(1);
      expect(personalGroups2.length).toBe(1);
      
      // The personal groups should be different
      expect(personalGroups1[0].id).not.toBe(personalGroups2[0].id);
    });

    it("includes proper displayLabel for different group types", async () => {
      const { token } = await createUserAndGetToken(false);
      
      // Create different types of groups
      await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: "Test Public", 
          groupType: "PUBLIC"
        });

      await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: "Test Private", 
          groupType: "PRIVATE"
        });

      const res = await request(app)
        .get("/groups")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      
      const publicGroup = res.body.find((g: any) => g.name === "Test Public");
      const privateGroup = res.body.find((g: any) => g.name === "Test Private");
      const personalGroup = res.body.find((g: any) => g.groupType === "PERSONAL");

      expect(publicGroup.displayLabel).toBe("Test Public public assembly room");
      expect(privateGroup.displayLabel).toBe("Test Private private assembly room");
      expect(personalGroup.displayLabel).toBe("Social Circle");
    });

    it("requires authentication", async () => {
      const res = await request(app)
        .get("/groups");
      
      expect(res.status).toBe(401);
    });
  });
});
