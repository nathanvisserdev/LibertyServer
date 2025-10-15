import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../index.js";

describe("posts endpoints", () => {
  it("create post returns 401 without auth", async () => {
    const res = await request(app)
      .post("/posts")
      .send({ content: "Hello world" });
    expect(res.status).toBe(401);
  });

  it("create and list posts returns 200 and valid JSON", async () => {
    const email = `user${Date.now()}@example.com`;
    await request(app)
      .post("/signup")
      .send({ email, password: "testpass" });
    const login = await request(app)
      .post("/login")
      .send({ email, password: "testpass" });
    const token = login.body.accessToken;
    const postRes = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "Hello world" });
    expect(postRes.status).toBe(201);
    expect(postRes.body).toHaveProperty("id");
    const listRes = await request(app)
      .get("/posts")
      .set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
  });
});
