import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import { app } from "../index.js";
import { prismaClient as prisma } from "../prismaClient.js";
import { generateUniqueEmail, generateUniqueUsername, generateTestNamespace } from './testUtils.js';

const request = supertest(app);
const testNamespace = generateTestNamespace('media-audience');

describe("Media Audience Authorization", () => {
  let aliceToken: string;
  let bobToken: string;
  let charlieToken: string;
  let aliceId: string;
  let bobId: string;
  let charlieId: string;
  let publicPostId: string;
  let acquaintancesPostId: string;
  let publicMediaKey: string;
  let acquaintancesMediaKey: string;

  beforeAll(async () => {
    // Alice (post author)
    const aliceRes = await request.post("/signup").send({
      username: generateUniqueUsername(),
      password: "password123",
      firstName: "Alice",
      lastName: "Media",
      email: generateUniqueEmail("alice", testNamespace),
      dateOfBirth: "1990-01-01",
      gender: "FEMALE",
      profilePhoto: "default.jpg",
      isPrivate: false
    });
    aliceToken = aliceRes.body.accessToken;
    aliceId = aliceRes.body.id;

    // Bob (acquaintance)
    const bobRes = await request.post("/signup").send({
      username: generateUniqueUsername(),
      password: "password123",
      firstName: "Bob",
      lastName: "Media",
      email: generateUniqueEmail("bob", testNamespace),
      dateOfBirth: "1990-01-01",
      gender: "MALE",
      profilePhoto: "default.jpg",
      isPrivate: false
    });
    bobToken = bobRes.body.accessToken;
    bobId = bobRes.body.id;

    // Charlie (stranger)
    const charlieRes = await request.post("/signup").send({
      username: generateUniqueUsername(),
      password: "password123",
      firstName: "Charlie",
      lastName: "Media",
      email: generateUniqueEmail("charlie", testNamespace),
      dateOfBirth: "1990-01-01",
      gender: "MALE",
      profilePhoto: "default.jpg",
      isPrivate: false
    });
    charlieToken = charlieRes.body.accessToken;
    charlieId = charlieRes.body.id;

    // Create connection between Alice and Bob (ACQUAINTANCE)
    const connection = await prisma.connection.create({
      data: {
        requesterId: aliceId < bobId ? aliceId : bobId,
        requestedId: aliceId < bobId ? bobId : aliceId,
        type: "ACQUAINTANCE"
      }
    });

    await prisma.userConnection.createMany({
      data: [
        {
          userId: aliceId,
          otherUserId: bobId,
          connectionId: connection.id,
          type: "ACQUAINTANCE"
        },
        {
          userId: bobId,
          otherUserId: aliceId,
          connectionId: connection.id,
          type: "ACQUAINTANCE"
        }
      ]
    });

    // Create connection between Alice and Charlie (STRANGER)
    const strangerConnection = await prisma.connection.create({
      data: {
        requesterId: aliceId < charlieId ? aliceId : charlieId,
        requestedId: aliceId < charlieId ? charlieId : aliceId,
        type: "STRANGER"
      }
    });

    await prisma.userConnection.createMany({
      data: [
        {
          userId: aliceId,
          otherUserId: charlieId,
          connectionId: strangerConnection.id,
          type: "STRANGER"
        },
        {
          userId: charlieId,
          otherUserId: aliceId,
          connectionId: strangerConnection.id,
          type: "STRANGER"
        }
      ]
    });

    // Create posts with mock media keys (using namespace for uniqueness)
    publicMediaKey = `photos/${aliceId}/public_${testNamespace}.jpg`;
    acquaintancesMediaKey = `photos/${aliceId}/acquaintances_${testNamespace}.jpg`;

    const publicPost = await request
      .post("/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        content: "Public post with media",
        media: publicMediaKey,
        visibility: "PUBLIC"
      });
    publicPostId = publicPost.body.postId;

    const acquaintancesPost = await request
      .post("/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        content: "Acquaintances post with media",
        media: acquaintancesMediaKey,
        visibility: "ACQUAINTANCES"
      });
    acquaintancesPostId = acquaintancesPost.body.postId;
  }, 30000);

  afterAll(async () => {
    // Clean up test data
    await prisma.post.deleteMany({
      where: {
        userId: { in: [aliceId, bobId, charlieId] }
      }
    });
    await prisma.userConnection.deleteMany({
      where: {
        userId: { in: [aliceId, bobId, charlieId] }
      }
    });
    await prisma.connection.deleteMany({
      where: {
        OR: [
          { requesterId: { in: [aliceId, bobId, charlieId] } },
          { requestedId: { in: [aliceId, bobId, charlieId] } }
        ]
      }
    });
    await prisma.user.deleteMany({
      where: { id: { in: [aliceId, bobId, charlieId] } }
    });
  });

  describe("POST /media/presign-read - Public post media", () => {
    it("should allow anyone to access PUBLIC post media", async () => {
      const res = await request
        .post("/media/presign-read")
        .set("Authorization", `Bearer ${charlieToken}`)
        .send({
          key: publicMediaKey,
          postId: publicPostId
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("url");
      expect(res.body).toHaveProperty("expiresAt");
    });
  });

  describe("POST /media/presign-read - ACQUAINTANCES post media", () => {
    it("should allow acquaintance (Bob) to access ACQUAINTANCES post media", async () => {
      const res = await request
        .post("/media/presign-read")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({
          key: acquaintancesMediaKey,
          postId: acquaintancesPostId
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("url");
      expect(res.body).toHaveProperty("expiresAt");
    });

    it("should deny stranger (Charlie) access to ACQUAINTANCES post media", async () => {
      const res = await request
        .post("/media/presign-read")
        .set("Authorization", `Bearer ${charlieToken}`)
        .send({
          key: acquaintancesMediaKey,
          postId: acquaintancesPostId
        });

      expect(res.status).toBe(403);
      expect(res.text).toContain("permission");
    });
  });

  describe("POST /media/presign-read - Profile photos (no postId)", () => {
    it("should allow access to profile photos without postId", async () => {
      const profilePhotoKey = `photos/${aliceId}/profile.jpg`;
      
      const res = await request
        .post("/media/presign-read")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({
          key: profilePhotoKey
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("url");
    });
  });

  describe("POST /media/presign-read - Invalid scenarios", () => {
    it("should reject if media key doesn't match post", async () => {
      const wrongKey = `photos/${aliceId}/wrong_${Date.now()}.jpg`;
      
      const res = await request
        .post("/media/presign-read")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({
          key: wrongKey,
          postId: publicPostId
        });

      expect(res.status).toBe(403);
      expect(res.text).toContain("does not match");
    });

    it("should reject if postId doesn't exist", async () => {
      const res = await request
        .post("/media/presign-read")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({
          key: publicMediaKey,
          postId: "nonexistent-post-id"
        });

      expect(res.status).toBe(404);
      expect(res.text).toContain("not found");
    });
  });
});
