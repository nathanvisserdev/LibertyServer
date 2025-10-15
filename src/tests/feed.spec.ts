import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../index.js";

describe("feed endpoints", () => {
  it("GET /feed/public-square returns items and nextCursor", async () => {
    const res = await request(app).get("/feed/public-square");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("nextCursor");
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
