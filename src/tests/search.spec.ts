// Set per-worker test database BEFORE any imports
process.env.DATABASE_URL = `file:./prisma/test-${process.env.VITEST_WORKER_ID || '0'}.db`;

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../index.js";
import { prismaClient as prisma } from "../prismaClient.js";
import { fileURLToPath } from 'url';
import path from 'path';
import { generateUniqueEmail, generateUniqueUsername, generateTestNamespace, generateUniqueString, generateUniqueUsernameWithPrefix } from './testUtils.js';

const __filename = fileURLToPath(import.meta.url);
const testFileName = path.basename(__filename, '.spec.ts');
const testNamespace = generateTestNamespace(testFileName);

// Simple counter for unique names
let nameCounter = 1;

// Helper function to create a user and get token
async function createUserAndGetToken(
  isPaidOrOptions?: boolean | {username?: string, firstName?: string, lastName?: string, email?: string}, 
  emailOrOptions?: string | {username?: string, firstName?: string, lastName?: string, email?: string}, 
  password?: string, 
  username?: string, 
  bio?: string
) {
  let isPaid = false;
  let userEmail: string;
  let userPassword: string;
  let userUsername: string;
  let firstName = "Test";
  let lastName = "User";
  
  // Handle different parameter patterns for backward compatibility
  if (typeof isPaidOrOptions === 'boolean') {
    isPaid = isPaidOrOptions;
    if (typeof emailOrOptions === 'object' && emailOrOptions !== null) {
      // Pattern: createUserAndGetToken(false, { username: "johndoe" })
      userEmail = emailOrOptions.email || generateUniqueEmail('test', testNamespace);
      userUsername = emailOrOptions.username || generateUniqueUsername();
      firstName = emailOrOptions.firstName || "Test";
      lastName = emailOrOptions.lastName || "User";
      userPassword = password || "testpass123";
    } else {
      // Pattern: createUserAndGetToken(false, "email@test.com", "password", "username")
      userEmail = emailOrOptions || generateUniqueEmail('test', testNamespace);
      userPassword = password || "testpass123";
      userUsername = username || generateUniqueUsername();
    }
  } else {
    // Handle legacy patterns or default
    userEmail = generateUniqueEmail('test', testNamespace);
    userPassword = "testpass123";
    userUsername = generateUniqueUsername();
  }
  
  const signupRes = await request(app)
    .post("/signup")
    .send({ 
      email: userEmail, 
      password: userPassword,
      firstName: firstName,
      lastName: lastName,
      username: userUsername,
      dateOfBirth: "1990-01-01",
      gender: "OTHER",
      profilePhoto: "https://example.com/photo.jpg",
      isPrivate: true,
      bio: bio || "Test bio"
    });
  
  // If isPaid is true, update the user to be paid
  if (isPaid) {
    await prisma.user.update({
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

describe("search endpoints", () => {
  // Clean up test data after all tests complete
  afterAll(async () => {
    // Only delete test users created by this test file
    await prisma.user.deleteMany({
      where: {
        email: {
          contains: testNamespace
        }
      }
    });
    await prisma.$disconnect();
  });

  describe("GET /search/users", () => {
    it("returns empty results for missing query", async () => {
      const { token } = await createUserAndGetToken();
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ users: [], groups: [] });
    });

    it("returns empty results for blank query", async () => {
      const { token } = await createUserAndGetToken();
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: "   " }); // blank spaces
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ users: [], groups: [] });
    });

    it("searches users by username", async () => {
      const { token } = await createUserAndGetToken();
      
      // Create a user with specific username
      const uniqueId = generateUniqueUsernameWithPrefix("johndoe");
      const searchableUser = await createUserAndGetToken(false, { username: uniqueId });
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: uniqueId });
      
      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(1);
      expect(res.body.users[0]).toMatchObject({
        id: searchableUser.userId,
        username: uniqueId,
        firstName: "Test",
        lastName: "User"
      });
      expect(res.body.users[0]).toHaveProperty("profilePhoto");
    });

    it("searches users by full name (first last)", async () => {
      const { token } = await createUserAndGetToken();
      
      // Create a user with very specific unique name that won't match others
      const firstName = `Alice${nameCounter}`;
      const lastName = `Johnson${nameCounter}`;
      const username = generateUniqueUsernameWithPrefix("alice");
      nameCounter++;
      
      await createUserAndGetToken(false, { 
        firstName, 
        lastName,
        username 
      });
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: `${firstName} ${lastName}` });
      
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeGreaterThan(0);
      
      // Find our specific user in the results
      const foundUser = res.body.users.find((u: any) => u.username === username);
      expect(foundUser).toMatchObject({
        firstName,
        lastName,
        username
      });
    });

    it("searches users by full name (last first)", async () => {
      const { token } = await createUserAndGetToken();
      
      // Create a user with very specific unique name that won't match others
      const firstName = `Bob${nameCounter}`;
      const lastName = `Smith${nameCounter}`;
      const username = generateUniqueUsernameWithPrefix("bobsmith");
      nameCounter++;
      
      await createUserAndGetToken(false, { 
        firstName,
        lastName,
        username
      });
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: `${lastName} ${firstName}` });
      
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeGreaterThan(0);
      
      // Find our specific user in the results
      const foundUser = res.body.users.find((u: any) => u.username === username);
      expect(foundUser).toMatchObject({
        firstName,
        lastName,
        username
      });
    });

    it("excludes banned users from search results", async () => {
      const { token } = await createUserAndGetToken();
      
      // Create a user and then ban them
      const uniqueId = generateUniqueUsernameWithPrefix("banneduser");
      const bannedUser = await createUserAndGetToken(false, { username: uniqueId });
      await prisma.user.update({
        where: { id: bannedUser.userId },
        data: { isBanned: true }
      });
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: uniqueId });
      
      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(0);
    });

    it("searches groups by name", async () => {
      const { token } = await createUserAndGetToken();
      
      // Create a group with unique name
      const groupName = generateUniqueString("JavaScript Developers", testNamespace);
      const groupRes = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: groupName,
          groupType: "AUTOCRATIC",
          groupPrivacy: "PUBLIC"
        });
      
      expect(groupRes.status).toBe(201);
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: groupName });
      
      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(1);
      expect(res.body.groups[0]).toMatchObject({
        id: groupRes.body.id,
        name: groupName,
        groupType: "AUTOCRATIC",
        groupPrivacy: "PUBLIC",
        isHidden: false
      });
    });

    it("excludes hidden groups for non-members", async () => {
      const { token: adminToken } = await createUserAndGetToken(true); // Paid admin
      const { token: userToken } = await createUserAndGetToken(false); // Regular user
      
      // Create a hidden group
      const groupRes = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Secret Society",
          groupType: "AUTOCRATIC",
          groupPrivacy: "PRIVATE",
          isHidden: true
        });
      
      expect(groupRes.status).toBe(201);
      
      // Regular user should not see the hidden group
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${userToken}`)
        .query({ q: "Secret" });
      
      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(0);
    });

    it("shows hidden groups to their admin", async () => {
      const { token } = await createUserAndGetToken(true); // Paid user
      
      // Create a hidden group
      const groupRes = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Admin Secret Group",
          groupType: "AUTOCRATIC",
          groupPrivacy: "PRIVATE",
          isHidden: true
        });
      
      expect(groupRes.status).toBe(201);
      
      // Admin should see their own hidden group
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: "Admin Secret" });
      
      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(1);
      expect(res.body.groups[0]).toMatchObject({
        name: "Admin Secret Group",
        isHidden: true
      });
    });

    it("shows hidden groups to their members", async () => {
      const { token: adminToken } = await createUserAndGetToken(true); // Paid admin
      const { token: memberToken, userId: memberId } = await createUserAndGetToken(false); // Member
      
      // Create a hidden group
      const groupRes = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Member Secret Group",
          groupType: "AUTOCRATIC",
          groupPrivacy: "PRIVATE",
          isHidden: true
        });
      
      expect(groupRes.status).toBe(201);
      const groupId = groupRes.body.id;
      
      // Add member to the group
      await prisma.groupMember.create({
        data: {
          userId: memberId,
          groupId: groupId
        }
      });
      
      // Member should see the hidden group they belong to
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${memberToken}`)
        .query({ q: "Member Secret" });
      
      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(1);
      expect(res.body.groups[0]).toMatchObject({
        name: "Member Secret Group",
        isHidden: true
      });
    });

    it("returns both users and groups in search results", async () => {
      const { token } = await createUserAndGetToken();
      
      // Create a user and group with unique search term
      const searchTerm = generateUniqueUsernameWithPrefix("unique");
      
      await createUserAndGetToken(false, { username: `${searchTerm}user` });
      
      await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: `${searchTerm} Group`,
          groupType: "AUTOCRATIC",
          groupPrivacy: "PUBLIC"
        });
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: searchTerm });
      
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeGreaterThan(0);
      expect(res.body.groups.length).toBeGreaterThan(0);
      
      // Check that users have required fields
      res.body.users.forEach((user: any) => {
        expect(user).toHaveProperty("id");
        expect(user).toHaveProperty("username");
        expect(user).toHaveProperty("firstName");
        expect(user).toHaveProperty("lastName");
        expect(user).toHaveProperty("profilePhoto");
      });
      
      // Check that groups have required fields
      res.body.groups.forEach((group: any) => {
        expect(group).toHaveProperty("id");
        expect(group).toHaveProperty("name");
        expect(group).toHaveProperty("groupType");
        expect(group).toHaveProperty("isHidden");
      });
    });

    it("requires authentication", async () => {
      const res = await request(app)
        .get("/search/users")
        .query({ q: "test" });
      
      expect(res.status).toBe(401);
    });

    it("handles single token search for username only", async () => {
      const { token } = await createUserAndGetToken();
      
      // Create user with specific username
      const uniqueId = generateUniqueUsernameWithPrefix("singletoken");
      await createUserAndGetToken(false, { username: uniqueId });
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: uniqueId }); // Single token
      
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeGreaterThan(0);
      
      // Find our specific user in the results
      const foundUser = res.body.users.find((u: any) => u.username === uniqueId);
      expect(foundUser).toBeDefined();
      expect(foundUser.username).toBe(uniqueId);
    });
  });
});
