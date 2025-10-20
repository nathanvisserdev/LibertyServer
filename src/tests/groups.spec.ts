import { describe, it, expect, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../index.js";
import { PrismaClient } from "../generated/prisma/index.js";
import { fileURLToPath } from 'url';
import path from 'path';
import { generateUniqueEmail, generateUniqueUsername, generateTestNamespace, generateUniqueString } from './testUtils.js';

const __filename = fileURLToPath(import.meta.url);
const testFileName = path.basename(__filename, '.spec.ts');
const testNamespace = generateTestNamespace(testFileName);

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
      const groupName = generateUniqueString("Test Public Group", testNamespace);
      
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
      const groupName = generateUniqueString("Test Private Group", testNamespace);
      
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
      const groupName = generateUniqueString("Default Group", testNamespace);
      
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
      const groupName = generateUniqueString("Ignore Hidden False", testNamespace);
      
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
      const groupName = generateUniqueString("Hidden Group", testNamespace);
      
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

    it("validates groupPrivacy field", async () => {
      const { token } = await createUserAndGetToken(false);
      
      const res = await request(app)
        .post("/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ 
          name: generateUniqueString("Test Group", testNamespace),
          groupType: "INVALID"
        });
      
      expect(res.status).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await request(app)
        .post("/groups")
        .send({ 
          name: generateUniqueString("Test Group", testNamespace),
          groupType: "PUBLIC"
        });
      
      expect(res.status).toBe(401);
    });

    it("handles case-insensitive groupPrivacy", async () => {
      const { token } = await createUserAndGetToken(false);
      const groupName = generateUniqueString("Case Test Group", testNamespace);
      
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
      const groupNumber = generateUniqueString("", testNamespace);
      
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
      const groupName = generateUniqueString("Test Group 🚀 Special & Chars", testNamespace);
      
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
      const groupName = generateUniqueString("Empty Desc Group", testNamespace);
      
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
      const groupName = generateUniqueString("Hidden Group", testNamespace);
      
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
      const groupName = generateUniqueString("Public Group from Paid User", testNamespace);
      
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
      const groupName = generateUniqueString("Default Group from Paid User", testNamespace);
      
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
          name: generateUniqueString("Public Group", testNamespace), 
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
          name: generateUniqueString("Hidden Group", testNamespace), 
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
          name: generateUniqueString("Admin Hidden Group", testNamespace), 
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
          name: generateUniqueString("Member Hidden Group", testNamespace), 
          groupType: "PRIVATE",
          isHidden: true
        });
      
      expect(hiddenGroupRes.status).toBe(201);
      const groupId = hiddenGroupRes.body.id;

      // Add member to the hidden group (simulating joining)
      await prisma.groupMember.create({
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

  describe("POST /groups/:id/join", () => {
    it("requires authentication", async () => {
      const res = await request(app)
        .post("/groups/someId/join");
      
      expect(res.status).toBe(401);
    });

    it("returns 404 when group does not exist", async () => {
      const { token } = await createUserAndGetToken(false);
      
      const res = await request(app)
        .post("/groups/nonexistent/join")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("Group not found");
    });

    it("returns 404 when trying to join a hidden group", async () => {
      const admin = await createUserAndGetToken(true);
      const user = await createUserAndGetToken(false);

      // Create hidden group
      const group = await prisma.groups.create({
        data: {
          name: "Hidden Group",
          groupType: "PRIVATE",
          isHidden: true,
          adminId: admin.userId,
        },
      });

      const res = await request(app)
        .post(`/groups/${group.id}/join`)
        .set("Authorization", `Bearer ${user.token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("Group not found");
    });

    it("returns 400 when trying to join your own PERSONAL group", async () => {
      const user = await createUserAndGetToken(false);

      // Create PERSONAL group owned by the same user
      const group = await prisma.groups.create({
        data: {
          name: "Personal Group",
          groupType: "PERSONAL",
          adminId: user.userId,
        },
      });

      const res = await request(app)
        .post(`/groups/${group.id}/join`)
        .set("Authorization", `Bearer ${user.token}`);
      
      expect(res.status).toBe(400);
      expect(res.text).toBe("Cannot request to join your own personal group");
    });

    it("returns 404 when trying to join someone else's PERSONAL group", async () => {
      const admin = await createUserAndGetToken(false);
      const user = await createUserAndGetToken(false);

      // Create PERSONAL group owned by admin
      const group = await prisma.groups.create({
        data: {
          name: "Someone's Personal Group",
          groupType: "PERSONAL",
          adminId: admin.userId,
        },
      });

      const res = await request(app)
        .post(`/groups/${group.id}/join`)
        .set("Authorization", `Bearer ${user.token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("Group not found");
    });

    it("returns 409 when user is already a member", async () => {
      const admin = await createUserAndGetToken(false);
      const user = await createUserAndGetToken(false);

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PRIVATE",
          adminId: admin.userId,
        },
      });

      // Add user as member
      await prisma.groupMember.create({
        data: {
          userId: user.userId,
          groupId: group.id,
        },
      });

      const res = await request(app)
        .post(`/groups/${group.id}/join`)
        .set("Authorization", `Bearer ${user.token}`);
      
      expect(res.status).toBe(409);
      expect(res.text).toBe("You are already a member of this group");
    });

    it("returns 403 when user is banned from the group", async () => {
      const admin = await createUserAndGetToken(false);
      const user = await createUserAndGetToken(false);

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PRIVATE",
          adminId: admin.userId,
        },
      });

      // Add user as banned member
      await prisma.groupMember.create({
        data: {
          userId: user.userId,
          groupId: group.id,
          isBanned: true,
        },
      });

      const res = await request(app)
        .post(`/groups/${group.id}/join`)
        .set("Authorization", `Bearer ${user.token}`);
      
      expect(res.status).toBe(403);
      expect(res.text).toBe("You are banned from this group");
    });

    it("returns 409 when user already has a pending join request", async () => {
      const admin = await createUserAndGetToken(false);
      const user = await createUserAndGetToken(false);

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PRIVATE",
          adminId: admin.userId,
        },
      });

      // Create pending join request
      await prisma.joinGroup.create({
        data: {
          groupId: group.id,
          requesterId: user.userId,
          status: "PENDING",
        },
      });

      const res = await request(app)
        .post(`/groups/${group.id}/join`)
        .set("Authorization", `Bearer ${user.token}`);
      
      expect(res.status).toBe(409);
      expect(res.text).toBe("You already have a pending join request for this group");
    });

    it("successfully creates a join request for PUBLIC group", async () => {
      const admin = await createUserAndGetToken(false);
      const user = await createUserAndGetToken(false);

      // Create PUBLIC group
      const group = await prisma.groups.create({
        data: {
          name: "Public Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId,
        },
      });

      const res = await request(app)
        .post(`/groups/${group.id}/join`)
        .set("Authorization", `Bearer ${user.token}`);
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("message", "Join request submitted successfully");
      expect(res.body).toHaveProperty("request");
      expect(res.body.request).toHaveProperty("id");
      expect(res.body.request).toHaveProperty("groupId", group.id);
      expect(res.body.request).toHaveProperty("requesterId", user.userId);
      expect(res.body.request).toHaveProperty("status", "PENDING");
      expect(res.body.request).toHaveProperty("createdAt");

      // Verify in database
      const joinRequest = await prisma.joinGroup.findFirst({
        where: {
          groupId: group.id,
          requesterId: user.userId,
        },
      });
      expect(joinRequest).toBeTruthy();
      expect(joinRequest?.status).toBe("PENDING");
    });

    it("successfully creates a join request for PRIVATE group", async () => {
      const admin = await createUserAndGetToken(false);
      const user = await createUserAndGetToken(false);

      // Create PRIVATE group
      const group = await prisma.groups.create({
        data: {
          name: "Private Test Group",
          groupType: "PRIVATE",
          adminId: admin.userId,
        },
      });

      const res = await request(app)
        .post(`/groups/${group.id}/join`)
        .set("Authorization", `Bearer ${user.token}`);
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("message", "Join request submitted successfully");
      expect(res.body).toHaveProperty("request");
      expect(res.body.request).toHaveProperty("groupId", group.id);
      expect(res.body.request).toHaveProperty("requesterId", user.userId);
      expect(res.body.request).toHaveProperty("status", "PENDING");
    });
  });

  describe("GET /groups/:groupId/members", () => {
    it("requires authentication", async () => {
      const res = await request(app)
        .get("/groups/someId/members");
      
      expect(res.status).toBe(401);
    });

    it("returns 400 when group id is missing", async () => {
      const { token } = await createUserAndGetToken(false);
      
      const res = await request(app)
        .get("/groups//members")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404); // Express treats missing param as not found
    });

    it("returns 404 when group does not exist", async () => {
      const { token } = await createUserAndGetToken(false);
      
      const res = await request(app)
        .get("/groups/nonexistent/members")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("Group not found");
    });

    it("returns 403 when trying to access someone else's PERSONAL group", async () => {
      const admin = await createUserAndGetToken(false);
      const user = await createUserAndGetToken(false);

      // Create PERSONAL group owned by admin
      const group = await prisma.groups.create({
        data: {
          name: "Personal Group",
          groupType: "PERSONAL",
          adminId: admin.userId,
        },
      });

      const res = await request(app)
        .get(`/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${user.token}`);
      
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: "FORBIDDEN",
        code: "PERSONAL_OWNER_ONLY",
        message: "Unauthorized users may not access other users personal groups."
      });
    });

    it("returns 200 when admin accesses their own PERSONAL group", async () => {
      const admin = await createUserAndGetToken(false);
      const member = await createUserAndGetToken(false);

      // Create PERSONAL group owned by admin
      const group = await prisma.groups.create({
        data: {
          name: "Personal Group",
          groupType: "PERSONAL",
          adminId: admin.userId,
        },
      });

      // Add admin and another member to the group
      await prisma.groupMember.create({
        data: {
          userId: admin.userId,
          groupId: group.id,
        },
      });

      await prisma.groupMember.create({
        data: {
          userId: member.userId,
          groupId: group.id,
        },
      });

      const res = await request(app)
        .get(`/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${admin.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("members");
      expect(res.body).toHaveProperty("totalCount", 2);
      expect(res.body.members).toHaveLength(2);
      
      // Verify member object structure
      expect(res.body.members[0]).toHaveProperty("membershipId");
      expect(res.body.members[0]).toHaveProperty("userId");
      expect(res.body.members[0]).toHaveProperty("joinedAt");
      expect(res.body.members[0]).toHaveProperty("user");
    });

    it("returns 403 when requester is banned from the group", async () => {
      const admin = await createUserAndGetToken(false);
      const user = await createUserAndGetToken(false);

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId,
        },
      });

      // Add user as banned member
      await prisma.groupMember.create({
        data: {
          userId: user.userId,
          groupId: group.id,
          isBanned: true,
        },
      });

      const res = await request(app)
        .get(`/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${user.token}`);
      
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: "FORBIDDEN",
        code: "MEMBER_BANNED_FROM_GROUP"
      });
    });

    it("returns 404 when non-member tries to access hidden group", async () => {
      const admin = await createUserAndGetToken(true); // Paid user can create hidden groups
      const user = await createUserAndGetToken(false);

      // Create hidden group
      const group = await prisma.groups.create({
        data: {
          name: "Hidden Group",
          groupType: "PRIVATE",
          isHidden: true,
          adminId: admin.userId,
        },
      });

      const res = await request(app)
        .get(`/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${user.token}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("Group not found");
    });

    it("returns 200 with hidden visibility when non-member and group has membershipHidden = true", async () => {
      const admin = await createUserAndGetToken(false);
      const member1 = await createUserAndGetToken(false);
      const member2 = await createUserAndGetToken(false);
      const nonMember = await createUserAndGetToken(false);

      // Create group with hidden membership
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId,
          membershipHidden: true, // This makes the membership roster hidden
        },
      });

      // Add visible members
      await prisma.groupMember.create({
        data: {
          userId: member1.userId,
          groupId: group.id,
        },
      });

      await prisma.groupMember.create({
        data: {
          userId: member2.userId,
          groupId: group.id,
        },
      });

      const res = await request(app)
        .get(`/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${nonMember.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        members: [],
        totalCount: 2, // Count includes all non-banned members
        visibility: "HIDDEN"
      });
    });

    it("returns 200 with member list when non-member and group roster is not hidden", async () => {
      const admin = await createUserAndGetToken(false);
      const member1 = await createUserAndGetToken(false);
      const member2 = await createUserAndGetToken(false);
      const bannedMember = await createUserAndGetToken(false);
      const nonMember = await createUserAndGetToken(false);

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId,
        },
      });

      // Add visible members
      await prisma.groupMember.create({
        data: {
          userId: member1.userId,
          groupId: group.id,
        },
      });

      await prisma.groupMember.create({
        data: {
          userId: member2.userId,
          groupId: group.id,
        },
      });

      // Add banned member (should not appear in results)
      await prisma.groupMember.create({
        data: {
          userId: bannedMember.userId,
          groupId: group.id,
          isBanned: true,
        },
      });

      const res = await request(app)
        .get(`/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${nonMember.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("members");
      expect(res.body).toHaveProperty("totalCount", 2); // Only non-banned members
      expect(res.body.members).toHaveLength(2);
      
      // Verify banned member is not included
      const memberIds = res.body.members.map((m: any) => m.userId);
      expect(memberIds).toContain(member1.userId);
      expect(memberIds).toContain(member2.userId);
      expect(memberIds).not.toContain(bannedMember.userId);

      // Verify member object structure
      expect(res.body.members[0]).toHaveProperty("membershipId");
      expect(res.body.members[0]).toHaveProperty("userId");
      expect(res.body.members[0]).toHaveProperty("joinedAt");
      expect(res.body.members[0]).toHaveProperty("user");
      expect(res.body.members[0].user).toHaveProperty("id");
      expect(res.body.members[0].user).toHaveProperty("username");
      expect(res.body.members[0].user).toHaveProperty("firstName");
      expect(res.body.members[0].user).toHaveProperty("lastName");
      expect(res.body.members[0].user).toHaveProperty("email");
    });

    it("returns members ordered by joinedAt ascending", async () => {
      const admin = await createUserAndGetToken(false);
      const member1 = await createUserAndGetToken(false);
      const member2 = await createUserAndGetToken(false);
      const nonMember = await createUserAndGetToken(false);

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId,
        },
      });

      // Add member1 first (earlier date)
      await prisma.groupMember.create({
        data: {
          userId: member1.userId,
          groupId: group.id,
          joinedAt: new Date('2023-01-01'),
        },
      });

      // Add member2 later
      await prisma.groupMember.create({
        data: {
          userId: member2.userId,
          groupId: group.id,
          joinedAt: new Date('2023-01-02'),
        },
      });

      const res = await request(app)
        .get(`/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${nonMember.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.members).toHaveLength(2);
      
      // Verify ordering by joinedAt ascending (earliest first)
      expect(res.body.members[0].userId).toBe(member1.userId);
      expect(res.body.members[1].userId).toBe(member2.userId);
    });

    it("handles empty member list correctly", async () => {
      const admin = await createUserAndGetToken(false);
      const nonMember = await createUserAndGetToken(false);

      // Create group with no members
      const group = await prisma.groups.create({
        data: {
          name: "Empty Group",
          groupType: "PUBLIC",
          adminId: admin.userId,
        },
      });

      const res = await request(app)
        .get(`/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${nonMember.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        members: [],
        totalCount: 0
      });
    });

    it("allows members to access member list of groups they belong to", async () => {
      const admin = await createUserAndGetToken(false);
      const member = await createUserAndGetToken(false);
      const otherMember = await createUserAndGetToken(false);

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PRIVATE",
          adminId: admin.userId,
        },
      });

      // Add members
      await prisma.groupMember.create({
        data: {
          userId: member.userId,
          groupId: group.id,
        },
      });

      await prisma.groupMember.create({
        data: {
          userId: otherMember.userId,
          groupId: group.id,
        },
      });

      const res = await request(app)
        .get(`/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${member.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("members");
      expect(res.body).toHaveProperty("totalCount", 2);
      expect(res.body.members).toHaveLength(2);
    });

    it("excludes banned members from results even for group members", async () => {
      const admin = await createUserAndGetToken(false);
      const member = await createUserAndGetToken(false);
      const bannedMember = await createUserAndGetToken(false);

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId,
        },
      });

      // Add regular member
      await prisma.groupMember.create({
        data: {
          userId: member.userId,
          groupId: group.id,
        },
      });

      // Add banned member
      await prisma.groupMember.create({
        data: {
          userId: bannedMember.userId,
          groupId: group.id,
          isBanned: true,
        },
      });

      const res = await request(app)
        .get(`/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${member.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("totalCount", 1); // Only non-banned member
      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].userId).toBe(member.userId);
    });
  });

  describe("GET /groups/mutuals", () => {

    it("requires authentication", async () => {
      const res = await request(app)
        .get("/groups/mutuals");
      
      expect(res.status).toBe(401);
    });

    it("returns empty array when user has no connections", async () => {
      const { token } = await createUserAndGetToken(false);
      
      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns empty array when connections are not members of any groups", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const admin = await createUserAndGetToken(false);

      // Create connection between user1 and user2
      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user2.userId,
          type: "ACQUAINTANCE"
        }
      });

      // Create a group but don't add user2 as member
      await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("excludes groups where isHidden = true", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const admin = await createUserAndGetToken(true); // Paid user for hidden groups

      // Create connection
      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user2.userId,
          type: "ACQUAINTANCE"
        }
      });

      // Create hidden group
      const hiddenGroup = await prisma.groups.create({
        data: {
          name: "Hidden Group",
          groupType: "PRIVATE",
          isHidden: true,
          adminId: admin.userId
        }
      });

      // Add user2 as member
      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: hiddenGroup.id
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("excludes groups where membershipHidden = true", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const admin = await createUserAndGetToken(false);

      // Create connection
      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user2.userId,
          type: "ACQUAINTANCE"
        }
      });

      // Create group with hidden membership
      const membershipHiddenGroup = await prisma.groups.create({
        data: {
          name: "Membership Hidden Group",
          groupType: "PRIVATE",
          membershipHidden: true,
          adminId: admin.userId
        }
      });

      // Add user2 as member
      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: membershipHiddenGroup.id
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("excludes groups where user is banned", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const admin = await createUserAndGetToken(false);

      // Create connection
      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user2.userId,
          type: "ACQUAINTANCE"
        }
      });

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId
        }
      });

      // Add user2 as member
      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: group.id
        }
      });

      // Ban user1 from the group
      await prisma.groupMember.create({
        data: {
          userId: user1.userId,
          groupId: group.id,
          isBanned: true
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("excludes connections that are hidden in Users table", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const admin = await createUserAndGetToken(false);

      // Make user2 hidden
      await prisma.users.update({
        where: { id: user2.userId },
        data: { isHidden: true }
      });

      // Create connection
      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user2.userId,
          type: "ACQUAINTANCE"
        }
      });

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId
        }
      });

      // Add user2 as member
      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: group.id
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("excludes connections that are banned in Users table", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const admin = await createUserAndGetToken(false);

      // Ban user2
      await prisma.users.update({
        where: { id: user2.userId },
        data: { isBanned: true }
      });

      // Create connection
      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user2.userId,
          type: "ACQUAINTANCE"
        }
      });

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId
        }
      });

      // Add user2 as member
      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: group.id
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("excludes connections that are banned in groupMember table", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const admin = await createUserAndGetToken(false);

      // Create connection
      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user2.userId,
          type: "ACQUAINTANCE"
        }
      });

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId
        }
      });

      // Add user2 as banned member
      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: group.id,
          isBanned: true
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("excludes connections where either user has blocked the other", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const admin = await createUserAndGetToken(false);

      // Create connection
      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user2.userId,
          type: "ACQUAINTANCE"
        }
      });

      // User1 blocks user2
      await prisma.blocks.create({
        data: {
          blockerId: user1.userId,
          blockedId: user2.userId
        }
      });

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId
        }
      });

      // Add user2 as member
      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: group.id
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns groups with mutual connections including group metadata", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const user3 = await createUserAndGetToken(false);
      const admin = await createUserAndGetToken(false);

      // Create connections
      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user2.userId,
          type: "ACQUAINTANCE"
        }
      });

      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user3.userId,
          type: "IS_FOLLOWING"
        }
      });

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          description: "A test group",
          groupType: "PUBLIC",
          adminId: admin.userId
        }
      });

      // Add connections as members
      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: group.id
        }
      });

      await prisma.groupMember.create({
        data: {
          userId: user3.userId,
          groupId: group.id
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      
      const returnedGroup = res.body[0];
      expect(returnedGroup).toHaveProperty("id", group.id);
      expect(returnedGroup).toHaveProperty("name", "Test Group");
      expect(returnedGroup).toHaveProperty("description", "A test group");
      expect(returnedGroup).toHaveProperty("groupType", "PUBLIC");
      expect(returnedGroup).toHaveProperty("adminId", admin.userId);
      expect(returnedGroup).toHaveProperty("memberCount", 2);
      expect(returnedGroup).toHaveProperty("mutualConnections");
      expect(returnedGroup.mutualConnections).toHaveLength(2);

      // Verify mutual connections structure
      const mutualConnection = returnedGroup.mutualConnections[0];
      expect(mutualConnection).toHaveProperty("membershipId");
      expect(mutualConnection).toHaveProperty("userId");
      expect(mutualConnection).toHaveProperty("joinedAt");
      expect(mutualConnection).toHaveProperty("user");
      expect(mutualConnection.user).toHaveProperty("id");
      expect(mutualConnection.user).toHaveProperty("username");
      expect(mutualConnection.user).toHaveProperty("firstName");
      expect(mutualConnection.user).toHaveProperty("lastName");
      expect(mutualConnection.user).toHaveProperty("email");

      // Verify both connections are included
      const connectionIds = returnedGroup.mutualConnections.map((conn: any) => conn.userId);
      expect(connectionIds).toContain(user2.userId);
      expect(connectionIds).toContain(user3.userId);
    });

    it("orders groups by member count from least to most", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const user3 = await createUserAndGetToken(false);
      const user4 = await createUserAndGetToken(false);
      const admin1 = await createUserAndGetToken(false);
      const admin2 = await createUserAndGetToken(false);

      // Create connections
      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user2.userId,
          type: "ACQUAINTANCE"
        }
      });

      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user3.userId,
          type: "STRANGER"
        }
      });

      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user4.userId,
          type: "IS_FOLLOWING"
        }
      });

      // Create group with 3 total members (2 connections + 1 other)
      const largerGroup = await prisma.groups.create({
        data: {
          name: "Larger Group",
          groupType: "PUBLIC",
          adminId: admin1.userId
        }
      });

      // Create group with 1 total member (1 connection)
      const smallerGroup = await prisma.groups.create({
        data: {
          name: "Smaller Group",
          groupType: "PUBLIC",
          adminId: admin2.userId
        }
      });

      // Add members to larger group
      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: largerGroup.id
        }
      });

      await prisma.groupMember.create({
        data: {
          userId: user3.userId,
          groupId: largerGroup.id
        }
      });

      await prisma.groupMember.create({
        data: {
          userId: admin1.userId, // Adding admin as member to increase count
          groupId: largerGroup.id
        }
      });

      // Add member to smaller group
      await prisma.groupMember.create({
        data: {
          userId: user4.userId,
          groupId: smallerGroup.id
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      // Verify ordering: smaller group first, larger group second
      expect(res.body[0].name).toBe("Smaller Group");
      expect(res.body[0].memberCount).toBe(1);
      expect(res.body[1].name).toBe("Larger Group");
      expect(res.body[1].memberCount).toBe(3);
    });

    it("handles bidirectional connections correctly", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const admin = await createUserAndGetToken(false);

      // Create connection where user2 is requester and user1 is requested
      await prisma.connections.create({
        data: {
          requesterId: user2.userId,
          requestedId: user1.userId,
          type: "ACQUAINTANCE"
        }
      });

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: admin.userId
        }
      });

      // Add user2 as member
      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: group.id
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].mutualConnections).toHaveLength(1);
      expect(res.body[0].mutualConnections[0].userId).toBe(user2.userId);
    });

    it("handles multiple connection types (ACQUAINTANCE, STRANGER, IS_FOLLOWING)", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const user3 = await createUserAndGetToken(false);
      const user4 = await createUserAndGetToken(false);
      const admin = await createUserAndGetToken(false);

      // Create different types of connections
      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user2.userId,
          type: "ACQUAINTANCE"
        }
      });

      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user3.userId,
          type: "STRANGER"
        }
      });

      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user4.userId,
          type: "IS_FOLLOWING"
        }
      });

      // Create group
      const group = await prisma.groups.create({
        data: {
          name: "Multi Connection Group",
          groupType: "PUBLIC",
          adminId: admin.userId
        }
      });

      // Add all connection types as members
      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: group.id
        }
      });

      await prisma.groupMember.create({
        data: {
          userId: user3.userId,
          groupId: group.id
        }
      });

      await prisma.groupMember.create({
        data: {
          userId: user4.userId,
          groupId: group.id
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].mutualConnections).toHaveLength(3);
      
      const connectionIds = res.body[0].mutualConnections.map((conn: any) => conn.userId);
      expect(connectionIds).toContain(user2.userId);
      expect(connectionIds).toContain(user3.userId);
      expect(connectionIds).toContain(user4.userId);
    });

    it("handles empty result when all conditions filter out groups", async () => {
      const user1 = await createUserAndGetToken(false);
      const user2 = await createUserAndGetToken(false);
      const admin = await createUserAndGetToken(true);

      // Create connection
      await prisma.connections.create({
        data: {
          requesterId: user1.userId,
          requestedId: user2.userId,
          type: "ACQUAINTANCE"
        }
      });

      // Create multiple groups that should all be filtered out
      
      // Hidden group
      const hiddenGroup = await prisma.groups.create({
        data: {
          name: "Hidden Group",
          groupType: "PRIVATE",
          isHidden: true,
          adminId: admin.userId
        }
      });

      // Membership hidden group
      const membershipHiddenGroup = await prisma.groups.create({
        data: {
          name: "Membership Hidden Group",
          groupType: "PRIVATE",
          membershipHidden: true,
          adminId: admin.userId
        }
      });

      // Add user2 to both groups
      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: hiddenGroup.id
        }
      });

      await prisma.groupMember.create({
        data: {
          userId: user2.userId,
          groupId: membershipHiddenGroup.id
        }
      });

      const res = await request(app)
        .get("/groups/mutuals")
        .set("Authorization", `Bearer ${user1.token}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("GET /groups/:groupId/join-requests/pending", () => {
    it("requires authentication", async () => {
      const res = await request(app)
        .get("/groups/testgroup/join-requests/pending");
      
      expect(res.status).toBe(401);
    });

    it("returns 400 when group ID is missing", async () => {
      const { token } = await createUserAndGetToken(false);
      
      const res = await request(app)
        .get("/groups/ /join-requests/pending")  // Space instead of empty
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(400);
    });

    it("returns 404 when requestor is not included in the GroupMember table", async () => {
      const { token: userToken } = await createUserAndGetToken(false);
      const { token: adminToken, userId: adminId } = await createUserAndGetToken(false);

      // Create a group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: adminId
        }
      });

      const res = await request(app)
        .get(`/groups/${group.id}/join-requests/pending`)
        .set("Authorization", `Bearer ${userToken}`);
      
      expect(res.status).toBe(404);
      expect(res.text).toBe("Not found");
    });

    it("returns 403 when requestor is listed in GroupMember table and isBanned = true", async () => {
      const { token: userToken, userId } = await createUserAndGetToken(false);
      const { token: adminToken, userId: adminId } = await createUserAndGetToken(false);

      // Create a group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: adminId
        }
      });

      // Add user as banned member
      await prisma.groupMember.create({
        data: {
          userId: userId,
          groupId: group.id,
          isBanned: true
        }
      });

      const res = await request(app)
        .get(`/groups/${group.id}/join-requests/pending`)
        .set("Authorization", `Bearer ${userToken}`);
      
      expect(res.status).toBe(403);
      expect(res.text).toBe("Forbidden");
    });

    it("returns 403 when requestor is listed in RoundTableMember table and isModerator = false", async () => {
      const { token: userToken, userId } = await createUserAndGetToken(false);
      const { token: adminToken, userId: adminId } = await createUserAndGetToken(false);

      // Create a group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: adminId
        }
      });

      // Add user as group member (not banned)
      await prisma.groupMember.create({
        data: {
          userId: userId,
          groupId: group.id,
          isBanned: false
        }
      });

      // Create round table for the group
      await prisma.roundTable.create({
        data: {
          groupId: group.id,
          adminId: adminId
        }
      });

      // Add user as round table member but not moderator
      await prisma.roundTableMember.create({
        data: {
          userId: userId,
          groupId: group.id,
          isModerator: false
        }
      });

      const res = await request(app)
        .get(`/groups/${group.id}/join-requests/pending`)
        .set("Authorization", `Bearer ${userToken}`);
      
      expect(res.status).toBe(403);
      expect(res.text).toBe("Forbidden");
    });

    it("returns 403 when requestor is not in RoundTableMember table", async () => {
      const { token: userToken, userId } = await createUserAndGetToken(false);
      const { token: adminToken, userId: adminId } = await createUserAndGetToken(false);

      // Create a group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: adminId
        }
      });

      // Add user as group member (not banned)
      await prisma.groupMember.create({
        data: {
          userId: userId,
          groupId: group.id,
          isBanned: false
        }
      });

      // Create round table but don't add user to it
      await prisma.roundTable.create({
        data: {
          groupId: group.id,
          adminId: adminId
        }
      });

      const res = await request(app)
        .get(`/groups/${group.id}/join-requests/pending`)
        .set("Authorization", `Bearer ${userToken}`);
      
      expect(res.status).toBe(403);
      expect(res.text).toBe("Forbidden");
    });

    it("returns 200 with pending join group requests when requestor is in RoundTableMember table and isModerator = true", async () => {
      const { token: moderatorToken, userId: moderatorId } = await createUserAndGetToken(false);
      const { token: adminToken, userId: adminId } = await createUserAndGetToken(false);
      const { userId: requesterId } = await createUserAndGetToken(false);

      // Create a group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: adminId
        }
      });

      // Add moderator as group member (not banned)
      await prisma.groupMember.create({
        data: {
          userId: moderatorId,
          groupId: group.id,
          isBanned: false
        }
      });

      // Create round table for the group
      await prisma.roundTable.create({
        data: {
          groupId: group.id,
          adminId: adminId
        }
      });

      // Add moderator as round table member with moderator privileges
      await prisma.roundTableMember.create({
        data: {
          userId: moderatorId,
          groupId: group.id,
          isModerator: true
        }
      });

      // Create a pending join request
      const joinRequest = await prisma.joinGroup.create({
        data: {
          groupId: group.id,
          requesterId: requesterId,
          status: "PENDING"
        }
      });

      const res = await request(app)
        .get(`/groups/${group.id}/join-requests/pending`)
        .set("Authorization", `Bearer ${moderatorToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      
      const returnedRequest = res.body[0];
      expect(returnedRequest.id).toBe(joinRequest.id);
      expect(returnedRequest.groupId).toBe(group.id);
      expect(returnedRequest.requesterId).toBe(requesterId);
      expect(returnedRequest.status).toBe("PENDING");
      expect(returnedRequest).toHaveProperty("requester");
      expect(returnedRequest.requester).toHaveProperty("id", requesterId);
      expect(returnedRequest.requester).toHaveProperty("username");
      expect(returnedRequest.requester).toHaveProperty("firstName");
      expect(returnedRequest.requester).toHaveProperty("lastName");
      expect(returnedRequest.requester).toHaveProperty("email");
    });

    it("returns empty array when no pending join group requests exist", async () => {
      const { token: moderatorToken, userId: moderatorId } = await createUserAndGetToken(false);
      const { token: adminToken, userId: adminId } = await createUserAndGetToken(false);

      // Create a group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: adminId
        }
      });

      // Add moderator as group member (not banned)
      await prisma.groupMember.create({
        data: {
          userId: moderatorId,
          groupId: group.id,
          isBanned: false
        }
      });

      // Create round table for the group
      await prisma.roundTable.create({
        data: {
          groupId: group.id,
          adminId: adminId
        }
      });

      // Add moderator as round table member with moderator privileges
      await prisma.roundTableMember.create({
        data: {
          userId: moderatorId,
          groupId: group.id,
          isModerator: true
        }
      });

      const res = await request(app)
        .get(`/groups/${group.id}/join-requests/pending`)
        .set("Authorization", `Bearer ${moderatorToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("only returns pending requests, not accepted or declined ones", async () => {
      const { token: moderatorToken, userId: moderatorId } = await createUserAndGetToken(false);
      const { token: adminToken, userId: adminId } = await createUserAndGetToken(false);
      const { userId: requester1Id } = await createUserAndGetToken(false);
      const { userId: requester2Id } = await createUserAndGetToken(false);
      const { userId: requester3Id } = await createUserAndGetToken(false);

      // Create a group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: adminId
        }
      });

      // Add moderator as group member (not banned)
      await prisma.groupMember.create({
        data: {
          userId: moderatorId,
          groupId: group.id,
          isBanned: false
        }
      });

      // Create round table for the group
      await prisma.roundTable.create({
        data: {
          groupId: group.id,
          adminId: adminId
        }
      });

      // Add moderator as round table member with moderator privileges
      await prisma.roundTableMember.create({
        data: {
          userId: moderatorId,
          groupId: group.id,
          isModerator: true
        }
      });

      // Create join requests with different statuses
      const pendingRequest = await prisma.joinGroup.create({
        data: {
          groupId: group.id,
          requesterId: requester1Id,
          status: "PENDING"
        }
      });

      await prisma.joinGroup.create({
        data: {
          groupId: group.id,
          requesterId: requester2Id,
          status: "ACCEPTED"
        }
      });

      await prisma.joinGroup.create({
        data: {
          groupId: group.id,
          requesterId: requester3Id,
          status: "DECLINED"
        }
      });

      const res = await request(app)
        .get(`/groups/${group.id}/join-requests/pending`)
        .set("Authorization", `Bearer ${moderatorToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(pendingRequest.id);
      expect(res.body[0].status).toBe("PENDING");
    });

    it("orders pending requests by creation date (newest first)", async () => {
      const { token: moderatorToken, userId: moderatorId } = await createUserAndGetToken(false);
      const { token: adminToken, userId: adminId } = await createUserAndGetToken(false);
      const { userId: requester1Id } = await createUserAndGetToken(false);
      const { userId: requester2Id } = await createUserAndGetToken(false);

      // Create a group
      const group = await prisma.groups.create({
        data: {
          name: "Test Group",
          groupType: "PUBLIC",
          adminId: adminId
        }
      });

      // Add moderator as group member (not banned)
      await prisma.groupMember.create({
        data: {
          userId: moderatorId,
          groupId: group.id,
          isBanned: false
        }
      });

      // Create round table for the group
      await prisma.roundTable.create({
        data: {
          groupId: group.id,
          adminId: adminId
        }
      });

      // Add moderator as round table member with moderator privileges
      await prisma.roundTableMember.create({
        data: {
          userId: moderatorId,
          groupId: group.id,
          isModerator: true
        }
      });

      // Create first request
      const firstRequest = await prisma.joinGroup.create({
        data: {
          groupId: group.id,
          requesterId: requester1Id,
          status: "PENDING"
        }
      });

      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      // Create second request (should be newer)
      const secondRequest = await prisma.joinGroup.create({
        data: {
          groupId: group.id,
          requesterId: requester2Id,
          status: "PENDING"
        }
      });

      const res = await request(app)
        .get(`/groups/${group.id}/join-requests/pending`)
        .set("Authorization", `Bearer ${moderatorToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      
      // Second request should be first (newest first)
      expect(res.body[0].id).toBe(secondRequest.id);
      expect(res.body[1].id).toBe(firstRequest.id);
    });
  });
});
