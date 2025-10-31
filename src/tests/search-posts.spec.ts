import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import { app } from "../index.js";
import { prismaClient as prisma } from "../prismaClient.js";
import { generateUniqueEmail, generateUniqueUsername, generateTestNamespace } from './testUtils.js';

const request = supertest(app);
const testNamespace = generateTestNamespace('search-posts');

describe("Post Search with Audience Authorization", () => {
  let aliceToken: string;
  let bobToken: string;
  let charlieToken: string;
  let aliceId: string;
  let bobId: string;
  let charlieId: string;
  let subnetId: string;

  beforeAll(async () => {
    // Alice (post author)
    const aliceRes = await request.post("/signup").send({
      username: generateUniqueUsername(),
      password: "password123",
      firstName: "Alice",
      lastName: "Search",
      email: generateUniqueEmail("alice", testNamespace),
      dateOfBirth: "1990-01-01",
      gender: "FEMALE",
      profilePhoto: "default.jpg",
      isPrivate: false
    });
    aliceToken = aliceRes.body.accessToken;
    aliceId = aliceRes.body.id;

    // Bob (acquaintance + subnet member)
    const bobRes = await request.post("/signup").send({
      username: generateUniqueUsername(),
      password: "password123",
      firstName: "Bob",
      lastName: "Search",
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
      lastName: "Search",
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

    // Create subnet with Bob as member
    const subnetRes = await request
      .post("/subnets")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        name: `SearchTestSubnet_${testNamespace}`,
        description: "Test subnet for search"
      });
    subnetId = subnetRes.body.id;

    await request
      .post(`/subnets/${subnetId}/members`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        userId: bobId,
        role: "CONTRIBUTOR"
      });

    // Create posts with searchable content
    await request
      .post("/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        content: "Public post about technology",
        visibility: "PUBLIC"
      });

    await request
      .post("/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        content: "Connections post about technology",
        visibility: "CONNECTIONS"
      });

    await request
      .post("/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        content: "Acquaintances post about technology",
        visibility: "ACQUAINTANCES"
      });

    await request
      .post("/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        content: "Subnet post about technology",
        visibility: "SUBNET",
        subnetId: subnetId
      });

    await request
      .post("/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        content: "Private post about secrets",
        visibility: "ACQUAINTANCES"
      });
  }, 30000);

  afterAll(async () => {
    // Clean up test data
    await prisma.post.deleteMany({
      where: {
        userId: { in: [aliceId, bobId, charlieId] }
      }
    });
    await prisma.subNetMember.deleteMany({
      where: { subNetId: subnetId }
    });
    await prisma.subNet.deleteMany({
      where: { id: subnetId }
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

  describe("GET /search/posts - Bob (acquaintance + subnet member)", () => {
    it("should return PUBLIC, CONNECTIONS, ACQUAINTANCES, and SUBNET posts", async () => {
      const res = await request
        .get("/search/posts")
        .query({ q: "technology" })
        .set("Authorization", `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      expect(res.body.posts).toBeDefined();
      expect(res.body.posts.length).toBe(4); // PUBLIC, CONNECTIONS, ACQUAINTANCES, SUBNET

      const visibilities = res.body.posts.map((p: any) => p.visibility);
      expect(visibilities).toContain("PUBLIC");
      expect(visibilities).toContain("CONNECTIONS");
      expect(visibilities).toContain("ACQUAINTANCES");
      expect(visibilities).toContain("SUBNET");
    });

    it("should NOT return posts that don't match search query", async () => {
      const res = await request
        .get("/search/posts")
        .query({ q: "technology" })
        .set("Authorization", `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      const contents = res.body.posts.map((p: any) => p.content);
      expect(contents.every((c: string) => c.includes("technology"))).toBe(true);
      expect(contents.some((c: string) => c.includes("secrets"))).toBe(false);
    });
  });

  describe("GET /search/posts - Charlie (stranger)", () => {
    it("should return only PUBLIC and CONNECTIONS posts", async () => {
      const res = await request
        .get("/search/posts")
        .query({ q: "technology" })
        .set("Authorization", `Bearer ${charlieToken}`);

      expect(res.status).toBe(200);
      expect(res.body.posts).toBeDefined();
      expect(res.body.posts.length).toBe(2); // PUBLIC, CONNECTIONS only

      const visibilities = res.body.posts.map((p: any) => p.visibility);
      expect(visibilities).toContain("PUBLIC");
      expect(visibilities).toContain("CONNECTIONS");
      expect(visibilities).not.toContain("ACQUAINTANCES");
      expect(visibilities).not.toContain("SUBNET");
    });
  });

  describe("GET /search/posts - Alice (post author)", () => {
    it("should return all of Alice's own posts matching query", async () => {
      const res = await request
        .get("/search/posts")
        .query({ q: "technology" })
        .set("Authorization", `Bearer ${aliceToken}`);

      expect(res.status).toBe(200);
      expect(res.body.posts).toBeDefined();
      expect(res.body.posts.length).toBe(4); // All her posts with "technology"

      const visibilities = res.body.posts.map((p: any) => p.visibility);
      expect(visibilities).toContain("PUBLIC");
      expect(visibilities).toContain("CONNECTIONS");
      expect(visibilities).toContain("ACQUAINTANCES");
      expect(visibilities).toContain("SUBNET");
    });
  });

  describe("GET /search/posts - Empty query", () => {
    it("should return empty results for blank query", async () => {
      const res = await request
        .get("/search/posts")
        .query({ q: "" })
        .set("Authorization", `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      expect(res.body.posts).toBeDefined();
      expect(res.body.posts.length).toBe(0);
    });

    it("should return empty results for missing query", async () => {
      const res = await request
        .get("/search/posts")
        .set("Authorization", `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      expect(res.body.posts).toBeDefined();
      expect(res.body.posts.length).toBe(0);
    });
  });

  describe("GET /search/posts - Response format", () => {
    it("should include user information in results", async () => {
      const res = await request
        .get("/search/posts")
        .query({ q: "technology" })
        .set("Authorization", `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      expect(res.body.posts.length).toBeGreaterThan(0);
      
      const firstPost = res.body.posts[0];
      expect(firstPost).toHaveProperty("id");
      expect(firstPost).toHaveProperty("content");
      expect(firstPost).toHaveProperty("visibility");
      expect(firstPost).toHaveProperty("createdAt");
      expect(firstPost).toHaveProperty("user");
      expect(firstPost.user).toHaveProperty("username");
      expect(firstPost.user).toHaveProperty("firstName");
      expect(firstPost.user).toHaveProperty("lastName");
    });

    it("should include subnet information for SUBNET posts", async () => {
      const res = await request
        .get("/search/posts")
        .query({ q: "technology" })
        .set("Authorization", `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      const subnetPost = res.body.posts.find((p: any) => p.visibility === "SUBNET");
      
      if (subnetPost) {
        expect(subnetPost).toHaveProperty("subNet");
        expect(subnetPost.subNet).toHaveProperty("id");
        expect(subnetPost.subNet).toHaveProperty("name");
      }
    });
  });
});
