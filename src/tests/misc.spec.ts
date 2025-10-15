import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../index.js";

describe("ping endpoint", () => {
  it("GET /ping returns 200 and 'ok'", async () => {
    const res = await request(app).get("/ping");
    expect(res.status).toBe(200);
    expect(res.text).toBe("ok");
  });
});