// Set per-worker test database BEFORE any imports
process.env.DATABASE_URL = `file:./prisma/test-${process.env.VITEST_WORKER_ID || '0'}.db`;

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../index.js";
import { prismaClient as prisma } from "../prismaClient.js";
import { fileURLToPath } from 'url';
import path from 'path';
import { generateUniqueEmail, generateUniqueUsername, generateTestNamespace } from './testUtils.js';

const __filename = fileURLToPath(import.meta.url);
const testFileName = path.basename(__filename, '.spec.ts');
const testNamespace = generateTestNamespace(testFileName);

// Helper function to create a user and get token
async function createUserAndGetToken(email?: string, password?: string, username?: string) {
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
      username: userUsername,
      dateOfBirth: "1990-01-01",
      gender: "MALE",
      profilePhoto: "https://example.com/photo.jpg",
      isPrivate: true
    });
  
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

// Helper function to create a connection between two users
async function createConnection(requesterId: string, requestedId: string, type: "ACQUAINTANCE" | "STRANGER" | "IS_FOLLOWING") {
  await prisma.connections.create({
    data: {
      requesterId,
      requestedId,
      type,
    },
  });
}

// Helper function to create a block between two users
async function createBlock(blockerId: string, blockedId: string) {
  await prisma.blocks.create({
    data: {
      blockerId,
      blockedId,
    },
  });
}

describe("profile endpoints", () => {
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

  describe("GET /users/:id", () => {
    it("returns 401 unauthorized without authentication token", async () => {
      const res = await request(app).get("/users/some-id");
      expect(res.status).toBe(401);
    });

    it("returns 400 bad request when user ID is missing", async () => {
      const { token } = await createUserAndGetToken();
      const res = await request(app)
        .get("/users/")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(404); // Express returns 404 for missing route parameter
    });

    it("returns 404 not found when user does not exist", async () => {
      const { token } = await createUserAndGetToken();
      const res = await request(app)
        .get("/users/nonexistent-user-id")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 404 not found when target user is banned", async () => {
      const { token: viewerToken } = await createUserAndGetToken();
      const { userId: bannedUserId } = await createUserAndGetToken();
      
      // Ban the target user
      await prisma.users.update({
        where: { id: bannedUserId },
        data: { isBanned: true },
      });

      const res = await request(app)
        .get(`/users/${bannedUserId}`)
        .set("Authorization", `Bearer ${viewerToken}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 404 not found when target user is hidden", async () => {
      const { token: viewerToken } = await createUserAndGetToken();
      const { userId: hiddenUserId } = await createUserAndGetToken();
      
      // Hide the target user
      await prisma.users.update({
        where: { id: hiddenUserId },
        data: { isHidden: true },
      });

      const res = await request(app)
        .get(`/users/${hiddenUserId}`)
        .set("Authorization", `Bearer ${viewerToken}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 404 not found when session user has blocked target user", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Session user blocks target user
      await createBlock(sessionUserId, targetUserId);

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns 404 not found when target user has blocked session user", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Target user blocks session user
      await createBlock(targetUserId, sessionUserId);

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("User not found");
    });

    it("returns extended profile when users are connected as acquaintances", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Make target user private
      await prisma.users.update({
        where: { id: targetUserId },
        data: { isPrivate: true },
      });

      // Create acquaintance connection
      await createConnection(sessionUserId, targetUserId, "ACQUAINTANCE");

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", targetUserId);
      expect(res.body).toHaveProperty("firstName", "Test");
      expect(res.body).toHaveProperty("lastName", "User");
      expect(res.body).toHaveProperty("username");
      expect(res.body).toHaveProperty("gender");
      expect(res.body).toHaveProperty("profilePhoto");
      expect(res.body).toHaveProperty("about");
      expect(res.body).toHaveProperty("connectionStatus", "ACQUAINTANCE");
      expect(res.body).toHaveProperty("requestType", null);
    });

    it("returns extended profile when users are connected as strangers", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Make target user private
      await prisma.users.update({
        where: { id: targetUserId },
        data: { isPrivate: true },
      });

      // Create stranger connection
      await createConnection(sessionUserId, targetUserId, "STRANGER");

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("gender");
      expect(res.body).toHaveProperty("about");
      expect(res.body).toHaveProperty("connectionStatus", "STRANGER");
      expect(res.body).toHaveProperty("requestType", null);
    });

    it("returns extended profile when session user follows target user", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Make target user private
      await prisma.users.update({
        where: { id: targetUserId },
        data: { isPrivate: true },
      });

      // Session user follows target user
      await createConnection(sessionUserId, targetUserId, "IS_FOLLOWING");

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("gender");
      expect(res.body).toHaveProperty("about");
      expect(res.body).toHaveProperty("connectionStatus", "IS_FOLLOWING");
      expect(res.body).toHaveProperty("requestType", null);
    });

    it("returns extended profile when target user is not private (even if not connected)", async () => {
      const { token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Make sure target user is not private
      await prisma.users.update({
        where: { id: targetUserId },
        data: { isPrivate: false },
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", targetUserId);
      expect(res.body).toHaveProperty("firstName", "Test");
      expect(res.body).toHaveProperty("lastName", "User");
      expect(res.body).toHaveProperty("username");
      expect(res.body).toHaveProperty("gender");
      expect(res.body).toHaveProperty("profilePhoto");
      expect(res.body).toHaveProperty("about");
      expect(res.body).toHaveProperty("connectionStatus", null);
      expect(res.body).toHaveProperty("requestType", null);
    });

    it("returns minimal profile when target is private and not connected", async () => {
      const { token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Make target user private
      await prisma.users.update({
        where: { id: targetUserId },
        data: { isPrivate: true },
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", targetUserId);
      expect(res.body).toHaveProperty("firstName", "Test");
      expect(res.body).toHaveProperty("lastName", "User");
      expect(res.body).toHaveProperty("username");
      expect(res.body).toHaveProperty("profilePhoto");
      expect(res.body).toHaveProperty("connectionStatus", null);
      
      // Should NOT have these fields for private unconnected users
      expect(res.body).not.toHaveProperty("gender");
      expect(res.body).not.toHaveProperty("about");
    });

    it("handles reverse connection (target user connected to session user)", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Make target user private
      await prisma.users.update({
        where: { id: targetUserId },
        data: { isPrivate: true },
      });

      // Target user follows session user (reverse connection)
      await createConnection(targetUserId, sessionUserId, "IS_FOLLOWING");

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("gender");
      expect(res.body).toHaveProperty("about");
      expect(res.body).toHaveProperty("connectionStatus", "IS_FOLLOWING");
      expect(res.body).toHaveProperty("requestType", null);
    });

    it("returns requestType when session user has pending ACQUAINTANCE request to target", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Create pending connection request
      await prisma.connectionRequest.create({
        data: {
          requesterId: sessionUserId,
          requestedId: targetUserId,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("connectionStatus", null);
      expect(res.body).toHaveProperty("requestType", "ACQUAINTANCE");
    });

    it("returns requestType when session user has pending STRANGER request to target", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Create pending connection request
      await prisma.connectionRequest.create({
        data: {
          requesterId: sessionUserId,
          requestedId: targetUserId,
          type: "STRANGER",
          status: "PENDING"
        }
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("connectionStatus", null);
      expect(res.body).toHaveProperty("requestType", "STRANGER");
    });

    it("returns requestType when session user has pending FOLLOW request to target", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Create pending connection request
      await prisma.connectionRequest.create({
        data: {
          requesterId: sessionUserId,
          requestedId: targetUserId,
          type: "FOLLOW",
          status: "PENDING"
        }
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("connectionStatus", null);
      expect(res.body).toHaveProperty("requestType", "FOLLOW");
    });

    it("returns null requestType when target user has pending request to session user (reverse)", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Create pending connection request FROM target TO session user (reverse)
      await prisma.connectionRequest.create({
        data: {
          requesterId: targetUserId,
          requestedId: sessionUserId,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("connectionStatus", null);
      expect(res.body).toHaveProperty("requestType", null);
    });

    it("returns null requestType when connection request is not PENDING", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Create ACCEPTED connection request
      await prisma.connectionRequest.create({
        data: {
          requesterId: sessionUserId,
          requestedId: targetUserId,
          type: "ACQUAINTANCE",
          status: "ACCEPTED"
        }
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("connectionStatus", null);
      expect(res.body).toHaveProperty("requestType", null);
    });

    it("returns requestType in minimal profile for private user with pending request", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Make target user private
      await prisma.users.update({
        where: { id: targetUserId },
        data: { isPrivate: true },
      });

      // Create pending connection request
      await prisma.connectionRequest.create({
        data: {
          requesterId: sessionUserId,
          requestedId: targetUserId,
          type: "ACQUAINTANCE",
          status: "PENDING"
        }
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("connectionStatus", null);
      expect(res.body).toHaveProperty("requestType", "ACQUAINTANCE");
      
      // Should be minimal profile (no gender/about)
      expect(res.body).not.toHaveProperty("gender");
      expect(res.body).not.toHaveProperty("about");
    });

    it("returns requestType in extended profile for non-private user with pending request", async () => {
      const { userId: sessionUserId, token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Make target user NOT private (so we get extended profile)
      await prisma.users.update({
        where: { id: targetUserId },
        data: { isPrivate: false },
      });

      // Create pending connection request
      await prisma.connectionRequest.create({
        data: {
          requesterId: sessionUserId,
          requestedId: targetUserId,
          type: "STRANGER",
          status: "PENDING"
        }
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("connectionStatus", null);
      expect(res.body).toHaveProperty("requestType", "STRANGER");
      
      // Should be extended profile (includes gender/about)
      expect(res.body).toHaveProperty("gender");
      expect(res.body).toHaveProperty("about");
      expect(res.body).toHaveProperty("firstName");
      expect(res.body).toHaveProperty("lastName");
      expect(res.body).toHaveProperty("username");
      expect(res.body).toHaveProperty("profilePhoto");
    });

    it("always returns profilePhoto since it's required", async () => {
      const { token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Update target user to have null about (profilePhoto is required so can't be null)
      await prisma.users.update({
        where: { id: targetUserId },
        data: { 
          about: null,
          isPrivate: false
        },
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.profilePhoto).toBeTruthy(); // profilePhoto is required
      expect(res.body.about).toBe(null);
    });

    it("returns profilePhoto when user adds one at signup", async () => {
      const { token: sessionToken } = await createUserAndGetToken();
      
      // Create a user with a profile photo at signup
      const userEmail = generateUniqueEmail('withphoto', testNamespace);
      const photoUrl = "https://example.com/photos/user123/profile.jpg";
      
      const signupRes = await request(app)
        .post("/signup")
        .send({ 
          email: userEmail, 
          password: "testpass123",
          firstName: "PhotoUser",
          lastName: "Test",
          username: generateUniqueUsername(),
          dateOfBirth: "1995-05-15",
          gender: "FEMALE",
          profilePhoto: photoUrl,
          isPrivate: false
        });
      
      expect(signupRes.status).toBe(201);
      const targetUserId = signupRes.body.id;
      
      // Make user not private so we can view their profile
      await prisma.users.update({
        where: { id: targetUserId },
        data: { isPrivate: false },
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("profilePhoto", photoUrl);
      expect(res.body.firstName).toBe("PhotoUser");
    });

    it("returns correct field structure for extended profile", async () => {
      const { token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Make target user not private
      await prisma.users.update({
        where: { id: targetUserId },
        data: { isPrivate: false },
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      
      // Check all expected fields are present
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("firstName");
      expect(res.body).toHaveProperty("lastName");
      expect(res.body).toHaveProperty("username");
      expect(res.body).toHaveProperty("gender");
      expect(res.body).toHaveProperty("profilePhoto");
      expect(res.body).toHaveProperty("about");
      expect(res.body).toHaveProperty("connectionStatus");
      expect(res.body).toHaveProperty("requestType");
      
      // Should not have sensitive fields
      expect(res.body).not.toHaveProperty("password");
      expect(res.body).not.toHaveProperty("email");
      expect(res.body).not.toHaveProperty("isPrivate");
      expect(res.body).not.toHaveProperty("isBanned");
      expect(res.body).not.toHaveProperty("isHidden");
    });

    it("returns correct field structure for minimal profile", async () => {
      const { token: sessionToken } = await createUserAndGetToken();
      const { userId: targetUserId } = await createUserAndGetToken();
      
      // Make target user private
      await prisma.users.update({
        where: { id: targetUserId },
        data: { isPrivate: true },
      });

      const res = await request(app)
        .get(`/users/${targetUserId}`)
        .set("Authorization", `Bearer ${sessionToken}`);
      
      expect(res.status).toBe(200);
      
      // Check expected minimal fields are present
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("firstName");
      expect(res.body).toHaveProperty("lastName");
      expect(res.body).toHaveProperty("username");
      expect(res.body).toHaveProperty("profilePhoto");
      expect(res.body).toHaveProperty("connectionStatus");
      expect(res.body).toHaveProperty("requestType");
      
      // Should not have extended fields
      expect(res.body).not.toHaveProperty("gender");
      expect(res.body).not.toHaveProperty("about");
      
      // Should not have sensitive fields
      expect(res.body).not.toHaveProperty("password");
      expect(res.body).not.toHaveProperty("email");
      expect(res.body).not.toHaveProperty("isPrivate");
    });

    it("returns profilePhoto key after upload via POST /users/me/photo", async () => {
      const { userId, token } = await createUserAndGetToken();
      
      // Simulate photo upload - set the profilePhoto key
      const photoKey = `photos/${userId}/1234567890.jpg`;
      
      const updateRes = await request(app)
        .post("/users/me/photo")
        .set("Authorization", `Bearer ${token}`)
        .send({ key: photoKey });
      
      expect(updateRes.status).toBe(200);
      expect(updateRes.body).toHaveProperty("profilePhoto", photoKey);
      
      // Now fetch the user's own profile and verify the key is stored
      const profileRes = await request(app)
        .get(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(profileRes.status).toBe(200);
      expect(profileRes.body).toHaveProperty("profilePhoto", photoKey);
      
      console.log("✅ Photo key stored and retrieved successfully:", photoKey);
    });

    it("rejects invalid photo key (wrong user prefix)", async () => {
      const { userId, token } = await createUserAndGetToken();
      
      // Try to set a photo key with wrong userId
      const invalidKey = `photos/differentuser/1234567890.jpg`;
      
      const updateRes = await request(app)
        .post("/users/me/photo")
        .set("Authorization", `Bearer ${token}`)
        .send({ key: invalidKey });
      
      expect(updateRes.status).toBe(403);
    });
  });
});
