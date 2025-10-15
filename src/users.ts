import { Router } from "express";
import { PrismaClient, Prisma } from "./generated/prisma/index.js";
import { auth } from "./misc.js";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const router = Router();

// --- Get the Current user object (requires token) ---
router.get("/user/me", auth, async (req, res) => {
  const payload = req.user;
  if (!payload || typeof payload !== "object" || !("id" in payload)) {
    return res.status(401).send("Invalid token payload");
  }
  const user = await prisma.users.findUnique({ where: { id: (payload as any).id } });
  if (!user) return res.status(404).send("User not found");
  res.json(user);
});

// --- Update user by ID (authenticated user can only update themselves) ---
router.patch("/users/:id", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = (req.user as any).id;
  const targetId = req.params.id;

  if (!targetId) {
    return res.status(400).send("Missing user ID");
  }

  // Only allow users to update themselves
  if (me !== targetId) {
    return res.status(403).send("Forbidden: Can only update your own profile");
  }

  const { firstName, lastName, dateOfBirth, gender, photo, about } = req.body ?? {};

  // Validate inputs
  const updateData: any = {};

  if (firstName !== undefined) {
    if (typeof firstName !== "string" || firstName.trim().length === 0 || firstName.length > 50) {
      return res.status(400).send("Invalid firstName: must be a non-empty string (max 50 chars)");
    }
    updateData.firstName = firstName.trim();
  }

  if (lastName !== undefined) {
    if (typeof lastName !== "string" || lastName.trim().length === 0 || lastName.length > 50) {
      return res.status(400).send("Invalid lastName: must be a non-empty string (max 50 chars)");
    }
    updateData.lastName = lastName.trim();
  }

  if (dateOfBirth !== undefined) {
    if (typeof dateOfBirth !== "string" || !dateOfBirth.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).send("Invalid dateOfBirth: must be in YYYY-MM-DD format");
    }
    const date = new Date(dateOfBirth);
    if (isNaN(date.getTime()) || date > new Date()) {
      return res.status(400).send("Invalid dateOfBirth: must be a valid date in the past");
    }
    updateData.dateOfBirth = date;
  }

  if (gender !== undefined) {
    const validGenders = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"] as const;
    if (typeof gender !== "string" || !validGenders.includes(gender as any)) {
      return res.status(400).send("Invalid gender: must be MALE, FEMALE, OTHER, or PREFER_NOT_TO_SAY");
    }
    updateData.gender = gender;
  }

  if (photo !== undefined) {
    if (typeof photo !== "string" || (photo.trim().length > 0 && !photo.match(/^https?:\/\/.+/))) {
      return res.status(400).send("Invalid photo: must be a valid URL or empty string");
    }
    updateData.photo = photo.trim() || null;
  }

  if (about !== undefined) {
    if (typeof about !== "string" || about.length > 500) {
      return res.status(400).send("Invalid about: must be a string (max 500 chars)");
    }
    updateData.about = about.trim() || null;
  }

  // If no valid fields to update
  if (Object.keys(updateData).length === 0) {
    return res.status(400).send("No valid fields to update");
  }

  try {
    const updatedUser = await prisma.users.update({
      where: { id: targetId },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        username: true,
        dateOfBirth: true,
        gender: true,
        photo: true,
        about: true,
        createdAt: true,
        isPrivateUser: true,
        // Exclude password, phoneNumber, zipCode, isBanned and other sensitive fields
      },
    });

    return res.status(200).json(updatedUser);
  } catch (e) {
    console.error(e);
    if (e instanceof Error && "code" in e && e.code === "P2002") {
      return res.status(409).json({ error: "Username already exists" });
    }
    if (e instanceof Error) {
      res.status(400).json({ error: e.message });
    } else {
      res.status(400).json({ error: String(e) });
    }
  }
});

// --- Delete user (requires password confirmation and cleanup) ---
router.delete("/user/me", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = (req.user as any).id;

  const { password } = req.body ?? {};
  if (!password || typeof password !== "string") {
    return res.status(400).send("missing password");
  }

  const user = await prisma.users.findUnique({ where: { id: me } });
  if (!user) return res.status(404).send("User not found");

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).send("invalid credentials");

  // Exclude PERSONAL from the admin check so users aren’t blocked by their Social Circle
  const adminGroups = await prisma.groups.findMany({
    where: { adminId: me, groupType: { not: "PERSONAL" } },
    select: { id: true }, // don't select groupType unless you need it
  });

  const force = String(req.query.force || "").toLowerCase() === "true";
  if (adminGroups.length && !force) {
    return res.status(409).json({
      error: "user_is_group_admin",
      message: "User administers groups. Reassign or call with ?force=true to delete them.",
    });
  }

  try {
    await prisma.$transaction(async tx => {
      // Always delete the user's PERSONAL group(s) (Social Circle) and their content
      const personal = await tx.groups.findMany({
        where: { adminId: me, groupType: "PERSONAL" },
        select: { id: true },
      });
      if (personal.length) {
        const ids = personal.map(g => g.id);
        await tx.posts.deleteMany({ where: { groupId: { in: ids } } });
        await tx.groupRoster.deleteMany({ where: { groupId: { in: ids } } });
        await tx.groups.deleteMany({ where: { id: { in: ids } } });
      }

      // If force=true, delete any OTHER groups they administer (and their content)
      if (force && adminGroups.length) {
        const ids = adminGroups.map(g => g.id);
        await tx.posts.deleteMany({ where: { groupId: { in: ids } } });
        await tx.groupRoster.deleteMany({ where: { groupId: { in: ids } } });
        await tx.groups.deleteMany({ where: { id: { in: ids } } });
      }

      // Connections/requests/blocks/roster/posts (user-level)
      await tx.connectionRequest.deleteMany({ where: { requesterId: me } });
      await tx.connectionRequest.deleteMany({ where: { requestedId: me } });
      await tx.connections.deleteMany({ where: { requesterId: me } });
      await tx.connections.deleteMany({ where: { requestedId: me } });
      await tx.blocks.deleteMany({ where: { OR: [{ blockerId: me }, { blockedId: me }] } });
      await tx.groupRoster.deleteMany({ where: { userId: me } });
      await tx.posts.deleteMany({ where: { userId: me } });

      // Finally, delete the user
      await tx.users.delete({ where: { id: me } });
    });

    return res.status(204).end();
  } catch (e) {
    console.error("Error during user deletion:", e);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return res.status(404).json({ error: "User not found" });
    }
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;