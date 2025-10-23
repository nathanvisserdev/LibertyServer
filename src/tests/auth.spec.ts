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

describe("auth endpoints", () => {
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

  it("login res 200 'ok' with token", async () => {
    const email = generateUniqueEmail('login', testNamespace);
    const username = generateUniqueUsername();
    await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username 
      });
    const res = await request(app)
      .post("/login")
      .send({ email, password: "testpass123" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
  });

  it("login w/wrong password res 401 'Unauthorized'", async () => {
    const email = generateUniqueEmail('wrongpass', testNamespace);
    const username = generateUniqueUsername();
    await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username: username 
      });
    const res = await request(app)
      .post("/login")
      .send({ email, password: "wrongpass" });
    expect(res.status).toBe(401);
  });

  it("rejects tokens from banned users", async () => {
    const email = generateUniqueEmail('banned', testNamespace);
    const username = generateUniqueUsername();
    
    // Create user and get token
    await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username: username 
      });
    
    const loginRes = await request(app)
      .post("/login")
      .send({ email, password: "testpass123" });
    
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.accessToken;
    
    // Verify token works initially by making a request that requires auth
    const initialRes = await request(app)
      .get("/user/me")
      .set("Authorization", `Bearer ${token}`);
    expect(initialRes.status).toBe(200);
    
    // Ban the user
    const user = await prisma.users.findUnique({ where: { email } });
    await prisma.users.update({
      where: { id: user!.id },
      data: { isBanned: true }
    });
    
    // Verify token is now rejected
    const bannedRes = await request(app)
      .get("/user/me")
      .set("Authorization", `Bearer ${token}`);
    expect(bannedRes.status).toBe(403);
    expect(bannedRes.text).toBe("Account banned");
  });
});
