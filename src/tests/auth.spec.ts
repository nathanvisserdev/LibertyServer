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

  it("signup: 201 created 'server successfully created new resource' and user", async () => {
    const email = generateUniqueEmail('test', testNamespace);
    const username = generateUniqueUsername();
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
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("email", email);
    expect(res.body).toHaveProperty("username", username);
    expect(res.body).toHaveProperty("firstName", "Test");
    expect(res.body).toHaveProperty("lastName", "User");
    expect(res.body).toHaveProperty("createdAt");
    expect(res.body).toHaveProperty("isPrivate");
    expect(res.body).not.toHaveProperty("password");
    expect(res.body).not.toHaveProperty("isPaid"); // Should never be in response
  });

  it("signup: 400 bad request when missing required fields", async () => {
    const uniqueEmail = generateUniqueEmail('test');
    
    const res = await request(app)
      .post("/signup")
      .send({ email: uniqueEmail, password: "testpass123" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Missing required fields");
  });

  it("signup: 400 bad request when password too short", async () => {
    const uniqueEmail = generateUniqueEmail('test');
    const username = generateUniqueUsername();
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: uniqueEmail, 
        password: "short", 
        firstName: "Test", 
        lastName: "User", 
        username 
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Password must be at least 8 characters");
  });

  it("signup: 400 bad request when username invalid format", async () => {
    const uniqueEmail = generateUniqueEmail('test');
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: uniqueEmail, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username: "AB" // too short and uppercase
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Username must be 3-100 characters");
  });

  it("signup: 400 bad request when isPaid field is present", async () => {
    const email1 = generateUniqueEmail('test1', testNamespace);
    
    // Test with isPaid: true
    const res1 = await request(app)
      .post("/signup")
      .send({ 
        email: email1, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username: generateUniqueUsername(),
        isPaid: true // This should be rejected
      });
    expect(res1.status).toBe(400);
    expect(res1.body).toHaveProperty("error");
    expect(res1.body.error).toContain("isPaid field is not allowed");

    // Test with isPaid: false (should also be rejected)
    const email2 = generateUniqueEmail('test2', testNamespace);
    const res2 = await request(app)
      .post("/signup")
      .send({ 
        email: email2, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username: generateUniqueUsername(),
        isPaid: false // This should also be rejected
      });
    expect(res2.status).toBe(400);
    expect(res2.body).toHaveProperty("error");
    expect(res2.body.error).toContain("isPaid field is not allowed");
  });

  it("signup: 409 conflictwhen email already exists", async () => {
    const email = generateUniqueEmail('duplicate');
    
    // Create first user
    await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "First", 
        lastName: "User", 
        username: generateUniqueUsername() 
      });

    // Try to create second user with same email
    const res = await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Second", 
        lastName: "User", 
        username: generateUniqueUsername() 
      });
    
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Email already exists");
  });

  it("signup: 409 conflict when username already exists", async () => {
    const username = generateUniqueUsername();
    
    // Create first user
    await request(app)
      .post("/signup")
      .send({ 
        email: generateUniqueEmail('first'), 
        password: "testpass123", 
        firstName: "First", 
        lastName: "User", 
        username 
      });

    // Try to create second user with same username
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: generateUniqueEmail('second'), 
        password: "testpass123", 
        firstName: "Second", 
        lastName: "User", 
        username 
      });
    
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Username already exists");
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
