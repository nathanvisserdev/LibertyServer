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

describe("POST /signup", () => {
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

  it("201 created 'server successfully created new resource' and user", async () => {
    const email = generateUniqueEmail('test', testNamespace);
    const username = generateUniqueUsername();
    const res = await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username,
        dateOfBirth: "1990-01-01",
        gender: "MALE",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("email", email);
    expect(res.body).toHaveProperty("username", username);
    expect(res.body).toHaveProperty("firstName", "Test");
    expect(res.body).toHaveProperty("lastName", "User");
    expect(res.body).toHaveProperty("dateOfBirth");
    expect(res.body).toHaveProperty("gender", "MALE");
    expect(res.body).toHaveProperty("profilePhoto", "https://example.com/photo.jpg");
    expect(res.body).toHaveProperty("isPrivate", true);
    expect(res.body).toHaveProperty("createdAt");
    expect(res.body).not.toHaveProperty("password");
    expect(res.body).not.toHaveProperty("isPaid"); // Should never be in response
  });

  it("400 bad request when missing required fields", async () => {
    const uniqueEmail = generateUniqueEmail('test');
    
    const res = await request(app)
      .post("/signup")
      .send({ email: uniqueEmail, password: "testpass123" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Missing required fields");
  });

  it("400 bad request when missing dateOfBirth", async () => {
    const uniqueEmail = generateUniqueEmail('test');
    const username = generateUniqueUsername();
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: uniqueEmail, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username,
        gender: "FEMALE",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Missing required fields");
    expect(res.body.error).toContain("dateOfBirth");
  });

  it("400 bad request when missing gender", async () => {
    const uniqueEmail = generateUniqueEmail('test');
    const username = generateUniqueUsername();
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: uniqueEmail, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username,
        dateOfBirth: "1990-01-01",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Missing required fields");
    expect(res.body.error).toContain("gender");
  });

  it("400 bad request when password too short", async () => {
    const uniqueEmail = generateUniqueEmail('test');
    const username = generateUniqueUsername();
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: uniqueEmail, 
        password: "short", 
        firstName: "Test", 
        lastName: "User", 
        username,
        dateOfBirth: "1990-01-01",
        gender: "OTHER",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: false
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Password must be at least 8 characters");
  });

  it("400 bad request when username invalid format", async () => {
    const uniqueEmail = generateUniqueEmail('test');
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: uniqueEmail, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username: "AB", // too short and uppercase
        dateOfBirth: "1990-01-01",
        gender: "OTHER",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Username must be 3-100 characters");
  });

  it("400 bad request when isPaid field is present", async () => {
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
        dateOfBirth: "1990-01-01",
        gender: "MALE",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true,
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
        dateOfBirth: "1990-01-01",
        gender: "FEMALE",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: false,
        isPaid: false // This should also be rejected
      });
    expect(res2.status).toBe(400);
    expect(res2.body).toHaveProperty("error");
    expect(res2.body.error).toContain("isPaid field is not allowed");
  });

  it("409 conflict when email already exists", async () => {
    const email = generateUniqueEmail('duplicate', testNamespace);
    
    // Create first user
    await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "First", 
        lastName: "User", 
        username: generateUniqueUsername(),
        dateOfBirth: "1990-01-01",
        gender: "MALE",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true
      });

    // Try to create second user with same email
    const res = await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Second", 
        lastName: "User", 
        username: generateUniqueUsername(),
        dateOfBirth: "1990-01-01",
        gender: "FEMALE",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: false
      });
    
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Email already exists");
  });

  it("409 conflict when username already exists", async () => {
    const username = generateUniqueUsername();
    
    // Create first user
    await request(app)
      .post("/signup")
      .send({ 
        email: generateUniqueEmail('first', testNamespace), 
        password: "testpass123", 
        firstName: "First", 
        lastName: "User", 
        username,
        dateOfBirth: "1990-01-01",
        gender: "MALE",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true
      });

    // Try to create second user with same username
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: generateUniqueEmail('second', testNamespace), 
        password: "testpass123", 
        firstName: "Second", 
        lastName: "User", 
        username,
        dateOfBirth: "1990-01-01",
        gender: "FEMALE",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: false
      });
    
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Username already exists");
  });

  it("400 bad request when dateOfBirth is invalid format", async () => {
    const uniqueEmail = generateUniqueEmail('invaliddate');
    const username = generateUniqueUsername();
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: uniqueEmail, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username,
        dateOfBirth: "not-a-date",
        gender: "MALE",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Invalid date format");
  });

  it("400 bad request when user is under 13 years old", async () => {
    const uniqueEmail = generateUniqueEmail('underage');
    const username = generateUniqueUsername();
    const recentDate = new Date();
    recentDate.setFullYear(recentDate.getFullYear() - 10); // 10 years ago
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: uniqueEmail, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username,
        dateOfBirth: recentDate.toISOString().split('T')[0],
        gender: "MALE",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("must be at least 13 years old");
  });

  it("400 bad request when gender is invalid", async () => {
    const uniqueEmail = generateUniqueEmail('invalidgender');
    const username = generateUniqueUsername();
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: uniqueEmail, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username,
        dateOfBirth: "1990-01-01",
        gender: "INVALID_GENDER",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Invalid gender value");
  });

  it("201 created with optional phoneNumber field", async () => {
    const email = generateUniqueEmail('withphone', testNamespace);
    const username = generateUniqueUsername();
    const phoneNumber = "+1-555-123-4567";
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username,
        dateOfBirth: "1990-01-01",
        gender: "FEMALE",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true,
        phoneNumber
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("phoneNumber", phoneNumber);
  });

  it("201 created with profilePhoto field", async () => {
    const email = generateUniqueEmail('withphoto', testNamespace);
    const username = generateUniqueUsername();
    const profilePhoto = "https://example.com/photo.jpg";
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username,
        dateOfBirth: "1990-01-01",
        gender: "OTHER",
        profilePhoto,
        isPrivate: false
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("profilePhoto", profilePhoto);
  });

  it("201 created with optional about field", async () => {
    const email = generateUniqueEmail('withabout', testNamespace);
    const username = generateUniqueUsername();
    const about = "This is my bio. I love coding!";
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username,
        dateOfBirth: "1990-01-01",
        gender: "OTHER",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true,
        about
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("about", about);
  });

  it("201 created with all optional fields", async () => {
    const email = generateUniqueEmail('allfields', testNamespace);
    const username = generateUniqueUsername();
    const phoneNumber = "+1-555-999-8888";
    const profilePhoto = "https://example.com/avatar.png";
    const about = "Full profile with all fields!";
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username,
        dateOfBirth: "1990-01-01",
        gender: "MALE",
        profilePhoto,
        isPrivate: false,
        phoneNumber,
        about
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("phoneNumber", phoneNumber);
    expect(res.body).toHaveProperty("profilePhoto", profilePhoto);
    expect(res.body).toHaveProperty("about", about);
  });

  it("400 bad request when about field is too long", async () => {
    const uniqueEmail = generateUniqueEmail('longabout');
    const username = generateUniqueUsername();
    const longAbout = "a".repeat(501); // Exceeds 500 character limit
    
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: uniqueEmail, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username,
        dateOfBirth: "1990-01-01",
        gender: "MALE",
        profilePhoto: "https://example.com/photo.jpg",
        isPrivate: true,
        about: longAbout
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("about must be at most 500 characters");
  });
});

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

      const signupRes = await request(app)
        .post("/signup")
        .send({
          email: uniqueEmail,
          password: "password123",
          firstName: "Test",
          lastName: "User",
          username: uniqueUsername,
          dateOfBirth: "1990-01-01",
          gender: "MALE",
          profilePhoto: "https://example.com/photo.jpg",
          isPrivate: true
        });
      
      // Verify signup succeeded
      expect(signupRes.status).toBe(201);
      expect(signupRes.body).toHaveProperty("id");

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

      const signupRes = await request(app)
        .post("/signup")
        .send({
          email: uniqueEmail,
          password: "password123",
          firstName: "Test",
          lastName: "User",
          username: uniqueUsername,
          dateOfBirth: "1990-01-01",
          gender: "FEMALE",
          profilePhoto: "https://example.com/photo.jpg",
          isPrivate: true
        });
      
      // Verify signup succeeded
      expect(signupRes.status).toBe(201);
      expect(signupRes.body).toHaveProperty("id");

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
          username: baseUsername.toLowerCase(),
          dateOfBirth: "1990-01-01",
          gender: "MALE",
          profilePhoto: "https://example.com/photo.jpg",
          isPrivate: true
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
          username: uniqueUsername,
          dateOfBirth: "1990-01-01",
          gender: "OTHER",
          profilePhoto: "https://example.com/photo.jpg",
          isPrivate: true
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

    it("returns 400 for empty string email", async () => {
      const res = await request(app)
        .post("/availability")
        .send({ email: "" });

      // Empty string fails email format validation
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe("Invalid email format");
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

    it("returns 400 for invalid email format", async () => {
      const invalidEmail = "not-an-email";

      const res = await request(app)
        .post("/availability")
        .send({ email: invalidEmail });

      // Now validates email format before checking database
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe("Invalid email format");
    });
  });
});
