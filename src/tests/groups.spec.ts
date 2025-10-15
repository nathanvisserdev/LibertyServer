import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../index.js";

describe("groups endpoints", () => {
  it("create group returns 401 without auth", async () => {
    const res = await request(app)
      .post("/groups")
      .send({ name: "Test Group", groupType: "PUBLIC" });
    expect(res.status).toBe(401);
  });

  it("create and list groups returns 200 and valid JSON", async () => {
    const email = `user${Date.now()}@example.com`;
    await request(app)
      .post("/signup")
      .send({ email, password: "testpass" });
    const login = await request(app)
      .post("/login")
      .send({ email, password: "testpass" });
    const token = login.body.accessToken;
    const groupRes = await request(app)
      .post("/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Test Group", groupType: "PUBLIC" });
    expect(groupRes.status).toBe(200);
    expect(groupRes.body).toHaveProperty("id");
    const listRes = await request(app)
  .get("/groups")
  .set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
  });
});
