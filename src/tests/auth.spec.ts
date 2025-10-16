import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../index.js";

describe("auth endpoints", () => {
  it("signup: 201 created 'server successfully created new resource' and user", async () => {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const email = `user${ts}@example.com`;
    const username = `user${ts}`;
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
    expect(res.body).toHaveProperty("isPrivateUser");
    expect(res.body).not.toHaveProperty("password");
  });

  it("signup: 400 bad request when missing required fields", async () => {
    const res = await request(app)
      .post("/signup")
      .send({ email: "test@example.com", password: "testpass123" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Missing required fields");
  });

  it("signup: 400 bad request when password too short", async () => {
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: "test@example.com", 
        password: "short", 
        firstName: "Test", 
        lastName: "User", 
        username: "testuser" 
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Password must be at least 8 characters");
  });

  it("signup: 400 bad request when username invalid format", async () => {
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: "test@example.com", 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username: "AB" // too short and uppercase
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Username must be 3-32 characters");
  });

  it("signup: 409 conflictwhen email already exists", async () => {
    const email = `duplicate${Date.now()}@example.com`;
    
    // Create first user
    await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "First", 
        lastName: "User", 
        username: `first${Date.now()}` 
      });

    // Try to create second user with same email
    const res = await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Second", 
        lastName: "User", 
        username: `second${Date.now()}` 
      });
    
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("Email already exists");
  });

  it("signup: 409 conflict when username already exists", async () => {
    const username = `duplicate${Date.now()}`;
    
    // Create first user
    await request(app)
      .post("/signup")
      .send({ 
        email: `first${Date.now()}@example.com`, 
        password: "testpass123", 
        firstName: "First", 
        lastName: "User", 
        username 
      });

    // Try to create second user with same username
    const res = await request(app)
      .post("/signup")
      .send({ 
        email: `second${Date.now()}@example.com`, 
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
    const email = `user${Date.now()}@example.com`;
    await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username: `user${Date.now()}` 
      });
    const res = await request(app)
      .post("/login")
      .send({ email, password: "testpass123" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
  });

  it("login w/wrong password res 401 'Unauthorized'", async () => {
    const email = `user${Date.now()}@example.com`;
    await request(app)
      .post("/signup")
      .send({ 
        email, 
        password: "testpass123", 
        firstName: "Test", 
        lastName: "User", 
        username: `user${Date.now()}` 
      });
    const res = await request(app)
      .post("/login")
      .send({ email, password: "wrongpass" });
    expect(res.status).toBe(401);
  });
});
