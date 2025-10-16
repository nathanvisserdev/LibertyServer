import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../index.js";
import { PrismaClient } from "../generated/prisma/index.js";

const prisma = new PrismaClient();

// Helper function to create a user and get auth token
async function createUserAndGetToken(isPaid = false) {
  const timestamp = Date.now();
  const email = `testuser${timestamp}@example.com`;
  const username = `testuser${timestamp}`;
  
  const res = await request(app)
    .post("/signup")
    .send({
      email,
      password: "testpass123",
      firstName: "Test",
      lastName: "User",
      username
    });
  
  expect(res.status).toBe(201);
  const userId = res.body.id;

  // If we need a paid user, manually update the database
  if (isPaid) {
    await prisma.users.update({
      where: { id: userId },
      data: { isPaid: true }
    });
  }

  // Login to get token
  const loginRes = await request(app)
    .post("/login")
    .send({ email, password: "testpass123" });
  
  expect(loginRes.status).toBe(200);
  return { token: loginRes.body.accessToken, userId, email, username };
}

describe("groups endpoints", () => {
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
});
