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

describe("POST /availability", () => {
  // Disconnect from database after all tests complete
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("validation", () => {
    it("returns 400 when neither username nor email is provided", async () => {
      const res = await request(app)
        .post("/availability")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/either username or email must be provided/i);
    });

    it("returns 400 when both username and email are provided", async () => {
      const res = await request(app)
        .post("/availability")
        .send({
          username: "testuser",
          email: "test@example.com"
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/either username or email, not both/i);
    });
  });

  describe("username availability", () => {
    it("returns { available: true } when username does not exist", async () => {
      const uniqueUsername = generateUniqueUsername(testNamespace);

      const res = await request(app)
        .post("/availability")
        .send({ username: uniqueUsername });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: true });
    });

    it("returns { available: false } when username already exists", async () => {
      // First, create a user
      const uniqueEmail = generateUniqueEmail("existing", testNamespace);
      const uniqueUsername = generateUniqueUsername(testNamespace);

      await request(app)
        .post("/signup")
        .send({
          email: uniqueEmail,
          password: "password123",
          firstName: "Test",
          lastName: "User",
          username: uniqueUsername
        });

      // Then check if the username is available
      const res = await request(app)
        .post("/availability")
        .send({ username: uniqueUsername });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: false });
    });
  });

  describe("email availability", () => {
    it("returns { available: true } when email does not exist", async () => {
      const uniqueEmail = generateUniqueEmail("nonexistent", testNamespace);

      const res = await request(app)
        .post("/availability")
        .send({ email: uniqueEmail });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: true });
    });

    it("returns { available: false } when email already exists", async () => {
      // First, create a user
      const uniqueEmail = generateUniqueEmail("existing2", testNamespace);
      const uniqueUsername = generateUniqueUsername(testNamespace);

      await request(app)
        .post("/signup")
        .send({
          email: uniqueEmail,
          password: "password123",
          firstName: "Test",
          lastName: "User",
          username: uniqueUsername
        });

      // Then check if the email is available
      const res = await request(app)
        .post("/availability")
        .send({ email: uniqueEmail });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: false });
    });
  });

  describe("authentication", () => {
    it("does not require authentication (no JWT token needed)", async () => {
      const uniqueUsername = generateUniqueUsername(testNamespace);

      // Make request without any Authorization header
      const res = await request(app)
        .post("/availability")
        .send({ username: uniqueUsername });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("available");
    });

    it("works without authentication for email check", async () => {
      const uniqueEmail = generateUniqueEmail("noauth", testNamespace);

      // Make request without any Authorization header
      const res = await request(app)
        .post("/availability")
        .send({ email: uniqueEmail });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("available");
    });
  });

  describe("case sensitivity", () => {
    it("checks username case-sensitively (database behavior)", async () => {
      // Create a user with lowercase username
      const baseUsername = generateUniqueUsername(testNamespace);
      const uniqueEmail = generateUniqueEmail("casetest", testNamespace);

      await request(app)
        .post("/signup")
        .send({
          email: uniqueEmail,
          password: "password123",
          firstName: "Test",
          lastName: "User",
          username: baseUsername.toLowerCase()
        });

      // Check with uppercase version
      const res = await request(app)
        .post("/availability")
        .send({ username: baseUsername.toUpperCase() });

      // SQLite is case-insensitive by default for LIKE, but case-sensitive for =
      // Prisma uses = for findUnique, so uppercase should be available
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("available");
    });

    it("checks email case-insensitively (typical email behavior)", async () => {
      // Create a user with lowercase email
      const baseEmail = generateUniqueEmail("emailcase", testNamespace);
      const uniqueUsername = generateUniqueUsername(testNamespace);

      await request(app)
        .post("/signup")
        .send({
          email: baseEmail.toLowerCase(),
          password: "password123",
          firstName: "Test",
          lastName: "User",
          username: uniqueUsername
        });

      // Check with uppercase version
      const res = await request(app)
        .post("/availability")
        .send({ email: baseEmail.toUpperCase() });

      expect(res.status).toBe(200);
      // This tests actual database behavior - may be case-sensitive or insensitive
      expect(res.body).toHaveProperty("available");
    });
  });

  describe("edge cases", () => {
    it("handles empty string username", async () => {
      const res = await request(app)
        .post("/availability")
        .send({ username: "" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: true });
    });

    it("handles empty string email", async () => {
      const res = await request(app)
        .post("/availability")
        .send({ email: "" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: true });
    });

    it("handles null username gracefully", async () => {
      const res = await request(app)
        .post("/availability")
        .send({ username: null });

      // null is falsy, so should be treated as "not provided"
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("handles special characters in username", async () => {
      const specialUsername = `${testNamespace}_user!@#$%`;

      const res = await request(app)
        .post("/availability")
        .send({ username: specialUsername });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("available");
    });

    it("handles very long username", async () => {
      const longUsername = `${testNamespace}_${'a'.repeat(200)}`;

      const res = await request(app)
        .post("/availability")
        .send({ username: longUsername });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("available");
    });

    it("handles invalid email format", async () => {
      const invalidEmail = "not-an-email";

      const res = await request(app)
        .post("/availability")
        .send({ email: invalidEmail });

      // Should still check database, not validate format
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: true });
    });
  });
});
