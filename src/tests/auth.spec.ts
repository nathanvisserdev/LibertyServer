import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../index.js";

describe("auth endpoints", () => {
  it("signup: 201 'server successfully created new resource' and user", async () => {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const email = `user${ts}@example.com`;
    const res = await request(app)
      .post("/signup")
      .send({ email, password: "testpass" });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("email", email);
  });

  it("login res 200 'ok' with token", async () => {
    const email = `user${Date.now()}@example.com`;
    await request(app)
      .post("/signup")
      .send({ email, password: "testpass" });
    const res = await request(app)
      .post("/login")
      .send({ email, password: "testpass" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
  });

  it("login w/wrong password res 401 'Unauthorized'", async () => {
    const email = `user${Date.now()}@example.com`;
    await request(app)
      .post("/signup")
      .send({ email, password: "testpass" });
    const res = await request(app)
      .post("/login")
      .send({ email, password: "wrongpass" });
    expect(res.status).toBe(401);
  });
});
