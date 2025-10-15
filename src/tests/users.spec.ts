import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../index.js";

// Helper function to create a user and get token
async function createUserAndGetToken(email?: string, password?: string) {
  const userEmail = email || `user${Date.now()}@example.com`;
  const userPassword = password || "testpass";
  
  const signupRes = await request(app)
    .post("/signup")
    .send({ email: userEmail, password: userPassword });
  
  const loginRes = await request(app)
    .post("/login")
    .send({ email: userEmail, password: userPassword });
  
  return {
    userId: signupRes.body.id,
    token: loginRes.body.accessToken,
    email: userEmail
  };
}

describe("user endpoints", () => {
  it("get /user/me returns 401 'Unauthorized' without token", async () => {
    const res = await request(app).get("/user/me");
    expect(res.status).toBe(401);
  });

  describe("PATCH /users/:id", () => {
    it("returns 401 'unauthorized' without authentication token", async () => {
      const res = await request(app)
        .patch("/users/some-id")
        .send({ firstName: "John" });
      expect(res.status).toBe(401);
    });

    it("returns 403 'forbidden' when trying to update another user", async () => {
      const { token } = await createUserAndGetToken();
      const { userId: otherUserId } = await createUserAndGetToken();
      
      const res = await request(app)
        .patch(`/users/${otherUserId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ firstName: "John" });
      
      expect(res.status).toBe(403);
      expect(res.text).toContain("Forbidden: Can only update your own profile");
    });

    it("successfully updates allowed fields", async () => {
      const { userId, token } = await createUserAndGetToken();
      
      const updateData = {
        firstName: "John",
        lastName: "Doe",
        dateOfBirth: "1990-01-01",
        gender: "MALE",
        photo: "https://example.com/photo.jpg",
        about: "This is my bio"
      };
      
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send(updateData);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("firstName", "John");
      expect(res.body).toHaveProperty("lastName", "Doe");
      expect(res.body).toHaveProperty("gender", "MALE");
      expect(res.body).toHaveProperty("photo", "https://example.com/photo.jpg");
      expect(res.body).toHaveProperty("about", "This is my bio");
      expect(res.body).not.toHaveProperty("password");
    });

    it("validates firstName - rejects empty string", async () => {
      const { userId, token } = await createUserAndGetToken();
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ firstName: "" });
      expect(res.status).toBe(400);
      expect(res.text).toContain("Invalid firstName");
    });

    it("validates firstName - rejects too long string", async () => {
      const { userId, token } = await createUserAndGetToken();
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ firstName: "a".repeat(51) });
      expect(res.status).toBe(400);
      expect(res.text).toContain("Invalid firstName");
    });

    it("validates lastName - rejects empty string", async () => {
      const { userId, token } = await createUserAndGetToken();
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ lastName: "" });
      expect(res.status).toBe(400);
      expect(res.text).toContain("Invalid lastName");
    });

    it("validates dateOfBirth - rejects invalid format", async () => {
      const { userId, token } = await createUserAndGetToken();
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ dateOfBirth: "invalid-date" });
      expect(res.status).toBe(400);
      expect(res.text).toContain("Invalid dateOfBirth");
    });

    it("validates dateOfBirth - rejects future date", async () => {
      const { userId, token } = await createUserAndGetToken();
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ dateOfBirth: futureDate.toISOString().split("T")[0] });
      expect(res.status).toBe(400);
      expect(res.text).toContain("Invalid dateOfBirth");
    });

    it("validates gender - rejects invalid value", async () => {
      const { userId, token } = await createUserAndGetToken();
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ gender: "INVALID_GENDER" });
      expect(res.status).toBe(400);
      expect(res.text).toContain("Invalid gender");
    });

    it("validates gender - accepts all valid enum values", async () => {
      const validGenders = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"];
      for (const gender of validGenders) {
        const { userId, token } = await createUserAndGetToken();
        const res = await request(app)
          .patch(`/users/${userId}`)
          .set("Authorization", `Bearer ${token}`)
          .send({ gender });
        expect(res.status).toBe(200);
        expect(res.body.gender).toBe(gender);
      }
    });

    it("validates photo - rejects invalid URL", async () => {
      const { userId, token } = await createUserAndGetToken();
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ photo: "not-a-url" });
      expect(res.status).toBe(400);
      expect(res.text).toContain("Invalid photo");
    });

    it("validates about - rejects too long string", async () => {
      const { userId, token } = await createUserAndGetToken();
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ about: "a".repeat(501) });
      expect(res.status).toBe(400);
      expect(res.text).toContain("Invalid about");
    });

    it("allows empty photo string", async () => {
      const { userId, token } = await createUserAndGetToken();
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ photo: "" });
      expect(res.status).toBe(200);
      expect(res.body.photo).toBe(null);
    });

    it("allows empty about string", async () => {
      const { userId, token } = await createUserAndGetToken();
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ about: "" });
      expect(res.status).toBe(200);
      expect(res.body.about).toBe(null);
    });

    it("returns 400 when no valid fields to update", async () => {
      const { userId, token } = await createUserAndGetToken();
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.text).toContain("No valid fields to update");
    });

    it("ignores forbidden fields like email and password", async () => {
      const { userId, token, email } = await createUserAndGetToken();
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          firstName: "John",
          email: "newemail@example.com",
          password: "newpassword",
          isBanned: true,
        });
      expect(res.status).toBe(200);
      expect(res.body.firstName).toBe("John");
      expect(res.body.email).toBe(email);
      expect(res.body).not.toHaveProperty("password");
    });

    it("trims whitespace from string fields", async () => {
      const { userId, token } = await createUserAndGetToken();
      const res = await request(app)
        .patch(`/users/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          firstName: "  John  ",
          lastName: "  Doe  ",
          about: "  My bio  ",
        });
      expect(res.status).toBe(200);
      expect(res.body.firstName).toBe("John");
      expect(res.body.lastName).toBe("Doe");
      expect(res.body.about).toBe("My bio");
    });
  });
});
