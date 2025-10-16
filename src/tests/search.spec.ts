import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../index.js";
import { PrismaClient } from "../generated/prisma/index.js";

const prisma = new PrismaClient();

// Helper function to create a user and get auth token
async function createUserAndGetToken(isPaid = false, userData?: { firstName?: string, lastName?: string, username?: string }) {
  const timestamp = Date.now() + Math.floor(Math.random() * 10000);
  const email = `testuser${timestamp}@example.com`;
  const username = userData?.username || `testuser${timestamp}`;
  const firstName = userData?.firstName || "Test";
  const lastName = userData?.lastName || "User";
  
  const res = await request(app)
    .post("/signup")
    .send({
      email,
      password: "testpass123",
      firstName,
      lastName,
      username
    });
  
  expect(res.status).toBe(201);
  const userId = res.body.id;

  // If we need a paid user, update the database
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
  return { token: loginRes.body.accessToken, userId, email, username, firstName, lastName };
}

describe("search endpoints", () => {
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
      const uniqueId = Date.now() + Math.floor(Math.random() * 10000);
      const searchableUser = await createUserAndGetToken(false, { username: `johndoe${uniqueId}` });
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: `johndoe${uniqueId}` });
      
      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(1);
      expect(res.body.users[0]).toMatchObject({
        id: searchableUser.userId,
        username: `johndoe${uniqueId}`,
        firstName: "Test",
        lastName: "User"
      });
      expect(res.body.users[0]).toHaveProperty("photo");
    });

    it("searches users by full name (first last)", async () => {
      const { token } = await createUserAndGetToken();
      
      // Create a user with very specific unique name that won't match others
      const uniqueId = Date.now() + Math.floor(Math.random() * 10000);
      const firstName = `Alicexyz${uniqueId}`;
      const lastName = `Johnsonxyz${uniqueId}`;
      
      await createUserAndGetToken(false, { 
        firstName, 
        lastName,
        username: `alice_j${uniqueId}` 
      });
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: `${firstName} ${lastName}` });
      
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeGreaterThan(0);
      
      // Find our specific user in the results
      const foundUser = res.body.users.find((u: any) => u.username === `alice_j${uniqueId}`);
      expect(foundUser).toMatchObject({
        firstName,
        lastName,
        username: `alice_j${uniqueId}`
      });
    });

    it("searches users by full name (last first)", async () => {
      const { token } = await createUserAndGetToken();
      
      // Create a user with very specific unique name that won't match others
      const uniqueId = Date.now() + Math.floor(Math.random() * 10000);
      const firstName = `Bobxyz${uniqueId}`;
      const lastName = `Smithxyz${uniqueId}`;
      
      await createUserAndGetToken(false, { 
        firstName,
        lastName,
        username: `bobsmith${uniqueId}` 
      });
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: `${lastName} ${firstName}` });
      
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeGreaterThan(0);
      
      // Find our specific user in the results
      const foundUser = res.body.users.find((u: any) => u.username === `bobsmith${uniqueId}`);
      expect(foundUser).toMatchObject({
        firstName,
        lastName,
        username: `bobsmith${uniqueId}`
      });
    });

    it("excludes banned users from search results", async () => {
      const { token } = await createUserAndGetToken();
      
      // Create a user and then ban them
      const uniqueId = Date.now() + Math.floor(Math.random() * 10000);
      const bannedUser = await createUserAndGetToken(false, { username: `banneduser${uniqueId}` });
      await prisma.users.update({
        where: { id: bannedUser.userId },
        data: { isBanned: true }
      });
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: `banneduser${uniqueId}` });
      
      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(0);
    });

    it("searches groups by name", async () => {
      const { token } = await createUserAndGetToken();
      
      // Create a group with unique name
      const uniqueId = Date.now() + Math.floor(Math.random() * 10000);
      const groupName = `JavaScript Developers ${uniqueId}`;
      const groupRes = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: groupName,
          groupType: "PUBLIC"
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
        groupType: "PUBLIC",
        isHidden: false
      });
    });

    it("excludes other users' PERSONAL groups", async () => {
      const { token: token1 } = await createUserAndGetToken();
      const { token: token2 } = await createUserAndGetToken();
      
      // Search for "Social" (PERSONAL groups are named "Social Circle")
      const res1 = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token1}`)
        .query({ q: "Social" });
      
      const res2 = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token2}`)
        .query({ q: "Social" });
      
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      
      // Each user should only see their own Social Circle
      expect(res1.body.groups).toHaveLength(1);
      expect(res2.body.groups).toHaveLength(1);
      expect(res1.body.groups[0].id).not.toBe(res2.body.groups[0].id);
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
          groupType: "PRIVATE",
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
          groupType: "PRIVATE",
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
          groupType: "PRIVATE",
          isHidden: true
        });
      
      expect(groupRes.status).toBe(201);
      const groupId = groupRes.body.id;
      
      // Add member to the group
      await prisma.groupRoster.create({
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
      const uniqueId = Date.now() + Math.floor(Math.random() * 10000);
      const searchTerm = `unique${uniqueId}`;
      
      await createUserAndGetToken(false, { username: `${searchTerm}user` });
      
      await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: `${searchTerm} Group`,
          groupType: "PUBLIC"
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
        expect(user).toHaveProperty("photo");
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
      const uniqueId = Date.now() + Math.floor(Math.random() * 10000);
      await createUserAndGetToken(false, { username: `singletoken${uniqueId}` });
      
      const res = await request(app)
        .get("/search/users")
        .set("Authorization", `Bearer ${token}`)
        .query({ q: `singletoken${uniqueId}` }); // Single token
      
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeGreaterThan(0);
      
      // Find our specific user in the results
      const foundUser = res.body.users.find((u: any) => u.username === `singletoken${uniqueId}`);
      expect(foundUser).toBeDefined();
      expect(foundUser.username).toBe(`singletoken${uniqueId}`);
    });
  });
});
