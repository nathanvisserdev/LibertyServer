import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../index.js";
import { prismaClient as prisma } from "../prismaClient.js";
import { generateUniqueEmail, generateUniqueUsername, generateTestNamespace } from './testUtils.js';

const testNamespace = generateTestNamespace('posts-audience');

describe("Posts Audience Authorization", () => {
  let aliceToken: string;
  let bobToken: string;
  let charlieToken: string;
  let aliceId: string;
  let bobId: string;
  let charlieId: string;
  let connectionId: string;
  let acquaintanceConnectionId: string;
  let subnetId: string;

  beforeAll(async () => {
    // Create Alice and wait for completion
    const aliceRes = await request(app).post("/signup").send({
      email: generateUniqueEmail("alice", testNamespace),
      username: generateUniqueUsername(),
      password: "password123",
      firstName: "Alice",
      lastName: "Smith",
      dateOfBirth: "1990-01-01",
      gender: "FEMALE",
      profilePhoto: "https://example.com/alice.jpg",
      isPrivate: false
    });
    
    if (aliceRes.status !== 201 || !aliceRes.body.id || !aliceRes.body.accessToken) {
      throw new Error(`Alice signup failed: ${JSON.stringify(aliceRes.body)}`);
    }
    
    aliceToken = aliceRes.body.accessToken;
    aliceId = aliceRes.body.id;

    // Create Bob and wait for completion
    const bobRes = await request(app).post("/signup").send({
      email: generateUniqueEmail("bob", testNamespace),
      username: generateUniqueUsername(),
      password: "password123",
      firstName: "Bob",
      lastName: "Jones",
      dateOfBirth: "1992-05-15",
      gender: "MALE",
      profilePhoto: "https://example.com/bob.jpg",
      isPrivate: false
    });
    
    if (bobRes.status !== 201 || !bobRes.body.id || !bobRes.body.accessToken) {
      throw new Error(`Bob signup failed: ${JSON.stringify(bobRes.body)}`);
    }
    
    bobToken = bobRes.body.accessToken;
    bobId = bobRes.body.id;

    // Create Charlie and wait for completion
    const charlieRes = await request(app).post("/signup").send({
      email: generateUniqueEmail("charlie", testNamespace),
      username: generateUniqueUsername(),
      password: "password123",
      firstName: "Charlie",
      lastName: "Brown",
      dateOfBirth: "1988-11-20",
      gender: "MALE",
      profilePhoto: "https://example.com/charlie.jpg",
      isPrivate: false
    });
    
    if (charlieRes.status !== 201 || !charlieRes.body.id || !charlieRes.body.accessToken) {
      throw new Error(`Charlie signup failed: ${JSON.stringify(charlieRes.body)}`);
    }
    
    charlieToken = charlieRes.body.accessToken;
    charlieId = charlieRes.body.id;

    // Wait for all users to be created, then create connections
    // Create ACQUAINTANCE connection between Alice and Bob directly in DB
    const acqConnection = await prisma.connection.create({
      data: {
        requesterId: aliceId < bobId ? aliceId : bobId,
        requestedId: aliceId < bobId ? bobId : aliceId,
        type: "ACQUAINTANCE"
      }
    });
    acquaintanceConnectionId = acqConnection.id;

    // Create user connection adjacency records for both users - wait for completion
    await prisma.userConnection.createMany({
      data: [
        { userId: aliceId, otherUserId: bobId, type: "ACQUAINTANCE", connectionId: acquaintanceConnectionId },
        { userId: bobId, otherUserId: aliceId, type: "ACQUAINTANCE", connectionId: acquaintanceConnectionId }
      ]
    });

    // Create STRANGER connection between Alice and Charlie - wait for acquaintance to complete first
    const strangerConn = await prisma.connection.create({
      data: {
        requesterId: aliceId < charlieId ? aliceId : charlieId,
        requestedId: aliceId < charlieId ? charlieId : aliceId,
        type: "STRANGER"
      }
    });
    connectionId = strangerConn.id;

    // Create user connection adjacency records - wait for connection creation
    await prisma.userConnection.createMany({
      data: [
        { userId: aliceId, otherUserId: charlieId, type: "STRANGER", connectionId: connectionId },
        { userId: charlieId, otherUserId: aliceId, type: "STRANGER", connectionId: connectionId }
      ]
    });

    // Create a subnet owned by Alice - wait for connections to complete
    const subnetRes = await request(app)
      .post("/subnets")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ name: "Test Subnet", slug: "test-subnet" });
    
    if (subnetRes.status !== 201 || !subnetRes.body.id) {
      throw new Error(`Subnet creation failed (status ${subnetRes.status}): ${JSON.stringify(subnetRes.body)}`);
    }
    subnetId = subnetRes.body.id;

    // Add Bob to subnet - wait for subnet creation
    const addMemberRes = await request(app)
      .post(`/subnets/${subnetId}/members`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ userIds: [bobId] });
    
    if (addMemberRes.status !== 200 && addMemberRes.status !== 201) {
      throw new Error(`Adding Bob to subnet failed: ${JSON.stringify(addMemberRes.body)}`);
    }

    // Update Bob's role to CONTRIBUTOR - wait for member addition
    await prisma.subNetMember.update({
      where: { subNetId_userId: { subNetId: subnetId, userId: bobId } },
      data: { role: "CONTRIBUTOR" },
    });
  }, 30000); // Increase timeout to 30 seconds for all setup

  describe("POST /posts - Create posts with different audiences", () => {
    it("should create a PUBLIC post", async () => {
      const res = await request(app)
        .post("/posts")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({
          content: "Public post from Alice",
          visibility: "PUBLIC"
        });

      expect(res.status).toBe(201);
      expect(res.body.visibility).toBe("PUBLIC");
    });

    it("should create a CONNECTIONS post", async () => {
      const res = await request(app)
        .post("/posts")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({
          content: "Connections only post",
          visibility: "CONNECTIONS"
        });

      expect(res.status).toBe(201);
      expect(res.body.visibility).toBe("CONNECTIONS");
    });

    it("should create an ACQUAINTANCES post", async () => {
      const res = await request(app)
        .post("/posts")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({
          content: "Acquaintances only post",
          visibility: "ACQUAINTANCES"
        });

      expect(res.status).toBe(201);
      expect(res.body.visibility).toBe("ACQUAINTANCES");
    });

    it("should create a SUBNET post when user has CONTRIBUTOR role", async () => {
      const res = await request(app)
        .post("/posts")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({
          content: "Subnet post from Bob",
          visibility: "SUBNET",
          subnetId: subnetId
        });

      expect(res.status).toBe(201);
      expect(res.body.visibility).toBe("SUBNET");
      expect(res.body.subNetId).toBe(subnetId);
    });

    it("should reject SUBNET post when user has VIEWER role", async () => {
      // Update Bob's role to VIEWER
      await prisma.subNetMember.update({
        where: { subNetId_userId: { subNetId: subnetId, userId: bobId } },
        data: { role: "VIEWER" },
      });

      const res = await request(app)
        .post("/posts")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({
          content: "Trying to post as viewer",
          visibility: "SUBNET",
          subnetId: subnetId
        });

      expect(res.status).toBe(403);
      expect(res.text).toContain("Insufficient permissions");

      // Restore CONTRIBUTOR role
      await prisma.subNetMember.update({
        where: { subNetId_userId: { subNetId: subnetId, userId: bobId } },
        data: { role: "CONTRIBUTOR" },
      });
    });
  });

  describe("GET /feed - Audience-based filtering", () => {
    let publicPostId: string;
    let connectionsPostId: string;
    let acquaintancesPostId: string;
    let subnetPostId: string;

    beforeEach(async () => {
      // Alice creates posts with different audiences
      const publicRes = await request(app)
        .post("/posts")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ content: "Public", visibility: "PUBLIC" });
      publicPostId = publicRes.body.postId;

      const connectionsRes = await request(app)
        .post("/posts")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ content: "Connections", visibility: "CONNECTIONS" });
      connectionsPostId = connectionsRes.body.postId;

      const acquaintancesRes = await request(app)
        .post("/posts")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ content: "Acquaintances", visibility: "ACQUAINTANCES" });
      acquaintancesPostId = acquaintancesRes.body.postId;

      const subnetRes = await request(app)
        .post("/posts")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ content: "Subnet", visibility: "SUBNET", subnetId: subnetId });
      subnetPostId = subnetRes.body.postId;
    });

    it("should show all Alice's posts to Alice herself", async () => {
      const res = await request(app)
        .get("/feed")
        .set("Authorization", `Bearer ${aliceToken}`);

      expect(res.status).toBe(200);
      const postIds = res.body.map((p: any) => p.postId);
      expect(postIds).toContain(publicPostId);
      expect(postIds).toContain(connectionsPostId);
      expect(postIds).toContain(acquaintancesPostId);
      expect(postIds).toContain(subnetPostId);
    });

    it("should show PUBLIC, CONNECTIONS, ACQUAINTANCES, and SUBNET posts to Bob (acquaintance + subnet member)", async () => {
      const res = await request(app)
        .get("/feed")
        .set("Authorization", `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      const postIds = res.body.map((p: any) => p.postId);
      expect(postIds).toContain(publicPostId);
      expect(postIds).toContain(connectionsPostId);
      expect(postIds).toContain(acquaintancesPostId);
      expect(postIds).toContain(subnetPostId);
    });

    it("should show only PUBLIC and CONNECTIONS posts to Charlie (stranger connection)", async () => {
      const res = await request(app)
        .get("/feed")
        .set("Authorization", `Bearer ${charlieToken}`);

      expect(res.status).toBe(200);
      const postIds = res.body.map((p: any) => p.postId);
      expect(postIds).toContain(publicPostId);
      expect(postIds).toContain(connectionsPostId);
      expect(postIds).not.toContain(acquaintancesPostId); // Not an acquaintance
      expect(postIds).not.toContain(subnetPostId); // Not in subnet
    });
  });

  describe("GET /posts/:id - Individual post authorization", () => {
    let privatePostId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post("/posts")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ content: "Acquaintances only", visibility: "ACQUAINTANCES" });
      privatePostId = res.body.postId;
    });

    it("should allow Bob (acquaintance) to view ACQUAINTANCES post", async () => {
      const res = await request(app)
        .get(`/posts/${privatePostId}`)
        .set("Authorization", `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe("Acquaintances only");
    });

    it("should deny Charlie (stranger) access to ACQUAINTANCES post", async () => {
      const res = await request(app)
        .get(`/posts/${privatePostId}`)
        .set("Authorization", `Bearer ${charlieToken}`);

      expect(res.status).toBe(403);
      expect(res.text).toContain("You do not have permission");
    });
  });
});
