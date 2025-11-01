import { Router } from "express";
import { Prisma } from "./generated/prisma/index.js";
import { auth } from "./misc.js";
import bcrypt from "bcrypt";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();

// --- Get the Current user object (requires token) ---
router.get("/user/me", auth, async (req, res) => {
  const payload = req.user;
  if (!payload || typeof payload !== "object" || !("id" in payload)) {
    return res.status(401).send("Invalid token payload");
  }
  const user = await prisma.user.findUnique({ 
    where: { id: (payload as any).id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      email: true,
      profilePhoto: true,
      about: true,
      gender: true,
      dateOfBirth: true,
      zipCode: true,
      isPrivate: true,
      isHidden: true,
      isBanned: true,
      createdAt: true,
      updatedAt: true,
      pendingRequestCount: true,
    }
  });
  if (!user) return res.status(404).send("User not found");
  return res.json(user);
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

  const { firstName, lastName, dateOfBirth, gender, profilePhoto, about } = req.body ?? {};

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
    const validGenders = ["MALE", "FEMALE", "OTHER"] as const;
    if (typeof gender !== "string" || !validGenders.includes(gender as any)) {
      return res.status(400).send("Invalid gender: must be MALE, FEMALE, or OTHER");
    }
    updateData.gender = gender;
  }

  if (profilePhoto !== undefined) {
    if (typeof profilePhoto !== "string") {
      return res.status(400).send("Invalid profilePhoto: must be a string");
    }
    const trimmed = profilePhoto.trim();
    if (trimmed.length === 0) {
      return res.status(400).send("Invalid profilePhoto: cannot be empty (profilePhoto is required)");
    }
    if (!trimmed.match(/^https?:\/\/.+/)) {
      return res.status(400).send("Invalid profilePhoto: must be a valid URL");
    }
    updateData.profilePhoto = trimmed;
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
    const updatedUser = await prisma.user.update({
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
        profilePhoto: true,
        about: true,
        createdAt: true,
        isPrivate: true,
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

// --- Update user security settings (email, password, isPrivate) ---
router.patch("/users/:id/settings/security", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = (req.user as any).id;
  const targetId = req.params.id;

  if (!targetId) {
    return res.status(400).send("Missing user ID");
  }

  // Only allow users to update their own security settings
  if (me !== targetId) {
    return res.status(403).send("Forbidden: Can only update your own security settings");
  }

  const { currentPassword, email, password, isPrivate } = req.body ?? {};

  // Current password is required for any security update
  if (!currentPassword || typeof currentPassword !== "string") {
    return res.status(400).send("currentPassword is required");
  }

  // Check if at least one valid field is provided
  if (email === undefined && password === undefined && isPrivate === undefined) {
    return res.status(400).send("No valid fields to update");
  }

  try {
    // Look up the user
    const user = await prisma.user.findUnique({ where: { id: targetId } });
    if (!user) {
      return res.status(404).send("User not found");
    }

    // Check if user is hidden or banned
    if (user.isHidden) {
      return res.status(404).send("User not found");
    }
    if (user.isBanned) {
      return res.status(403).send("Account banned");
    }

    // Verify current password
    const passwordValid = await bcrypt.compare(currentPassword, user.password);
    if (!passwordValid) {
      return res.status(401).send("Invalid current password");
    }

    // Prepare update data
    const updateData: any = {};

    // Handle email update
    if (email !== undefined) {
      if (typeof email !== "string") {
        return res.status(400).send("Invalid email: must be a string");
      }
      const emailStr = email.toLowerCase().trim();
      if (!emailStr.includes("@") || emailStr.length < 3) {
        return res.status(400).send("Invalid email format");
      }
      
      // Check if email is already in use by another user
      const existing = await prisma.user.findUnique({ where: { email: emailStr } });
      if (existing && existing.id !== targetId) {
        return res.status(409).json({ error: "Email already exists" });
      }
      
      updateData.email = emailStr;
    }

    // Handle password update
    if (password !== undefined) {
      if (typeof password !== "string") {
        return res.status(400).send("Invalid password: must be a string");
      }
      if (password.length < 8) {
        return res.status(400).send("Password must be at least 8 characters long");
      }
      const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
      updateData.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    }

    // Handle isPrivate update
    if (isPrivate !== undefined) {
      if (typeof isPrivate !== "boolean") {
        return res.status(400).send("Invalid isPrivate: must be a boolean");
      }
      updateData.isPrivate = isPrivate;
    }

    // Update the user
    const updatedUser = await prisma.user.update({
      where: { id: targetId },
      data: updateData,
      select: {
        id: true,
        email: true,
        isPrivate: true,
        updatedAt: true,
      },
    });

    return res.status(200).json(updatedUser);
  } catch (e) {
    console.error(e);
    if (e instanceof Error && "code" in e && e.code === "P2002") {
      // Unique constraint violation
      const meta = (e as any).meta;
      if (meta?.target?.includes("email")) {
        return res.status(409).json({ error: "Email already exists" });
      }
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

  const user = await prisma.user.findUnique({ where: { id: me } });
  if (!user) return res.status(404).send("User not found");

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).send("invalid credentials");

  // Exclude PERSONAL from the admin check so users aren't blocked by their Social Circle
  const adminGroups = await prisma.group.findMany({
    where: { adminId: me, groupPrivacy: { not: "PERSONAL" } },
    select: { id: true },
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
      const personal = await tx.group.findMany({
        where: { adminId: me, groupPrivacy: "PERSONAL" },
        select: { id: true },
      });
      if (personal.length) {
        const ids = personal.map(g => g.id);
        await tx.post.deleteMany({ where: { groupId: { in: ids } } });
        await tx.groupMember.deleteMany({ where: { groupId: { in: ids } } });
        await tx.group.deleteMany({ where: { id: { in: ids } } });
      }

      // If force=true, delete any OTHER groups they administer (and their content)
      if (force && adminGroups.length) {
        const ids = adminGroups.map(g => g.id);
        await tx.post.deleteMany({ where: { groupId: { in: ids } } });
        await tx.groupMember.deleteMany({ where: { groupId: { in: ids } } });
        await tx.group.deleteMany({ where: { id: { in: ids } } });
      }

      // Connections/requests/blocks/roster/posts (user-level)
      await tx.connectionRequest.deleteMany({ where: { requesterId: me } });
      await tx.connectionRequest.deleteMany({ where: { requestedId: me } });
      await tx.connection.deleteMany({ where: { requesterId: me } });
      await tx.connection.deleteMany({ where: { requestedId: me } });
      await tx.block.deleteMany({ where: { OR: [{ blockerId: me }, { blockedId: me }] } });
      await tx.groupMember.deleteMany({ where: { userId: me } });
      await tx.post.deleteMany({ where: { userId: me } });

      // Finally, delete the user
      await tx.user.delete({ where: { id: me } });
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

// --- Get a user's followers ---
router.get("/users/:id/followers", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = (req.user as any).id;
  const targetUserId = req.params.id;

  if (!targetUserId) {
    return res.status(400).send("Missing user ID");
  }

  try {
    // Check if target user exists and is not banned/hidden
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        isPrivate: true,
        isBanned: true,
        isHidden: true
      }
    });

    if (!targetUser || targetUser.isBanned || targetUser.isHidden) {
      return res.status(404).send("User not found");
    }

    // Check for blocks in either direction between session user and target user
    const blockExists = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: sessionUserId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: sessionUserId }
        ]
      }
    });

    if (blockExists) {
      return res.status(404).send("User not found");
    }

    // If user is private, check if session user is connected
    if (targetUser.isPrivate && sessionUserId !== targetUserId) {
      const connection = await prisma.userConnection.findFirst({
        where: {
          userId: sessionUserId,
          otherUserId: targetUserId,
          type: { in: ["ACQUAINTANCE", "STRANGER"] }
        }
      });

      if (!connection) {
        return res.status(403).send("This user's followers list is private");
      }
    }

    // Get all users who follow the target user
    const followerConnections = await prisma.userConnection.findMany({
      where: {
        otherUserId: targetUserId,
        type: "IS_FOLLOWING"
      },
      select: {
        userId: true
      }
    });

    const followerIds = followerConnections.map((fc: any) => fc.userId);

    if (followerIds.length === 0) {
      return res.status(200).json([]);
    }

    // Get blocks involving the session user
    const sessionUserBlocks = await prisma.block.findMany({
      where: {
        OR: [
          { blockerId: sessionUserId },
          { blockedId: sessionUserId }
        ]
      },
      select: {
        blockerId: true,
        blockedId: true
      }
    });

    const blockedUserIds = new Set(
      sessionUserBlocks.map((b: any) => 
        b.blockerId === sessionUserId ? b.blockedId : b.blockerId
      )
    );

    // Filter out blocked users and get user details
    const followers = await prisma.user.findMany({
      where: {
        id: { in: followerIds },
        isBanned: false,
        isHidden: false,
        NOT: {
          id: { in: Array.from(blockedUserIds) }
        }
      },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        profilePhoto: true
      },
      orderBy: {
        username: 'asc'
      }
    });

    return res.status(200).json(followers);

  } catch (e) {
    console.error("Error fetching followers:", e);
    if (e instanceof Error) {
      return res.status(400).json({ error: e.message });
    } else {
      return res.status(400).json({ error: String(e) });
    }
  }
});

// --- Get list of users that a specific user is following ---
router.get("/users/:id/following", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = (req.user as any).id;
  const targetUserId = req.params.id;

  if (!targetUserId) {
    return res.status(400).send("Missing user ID");
  }

  try {
    // Check if target user exists and is not banned/hidden
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        isPrivate: true,
        isBanned: true,
        isHidden: true
      }
    });

    if (!targetUser || targetUser.isBanned || targetUser.isHidden) {
      return res.status(404).send("User not found");
    }

    // Check for blocks in either direction between session user and target user
    const blockExists = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: sessionUserId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: sessionUserId }
        ]
      }
    });

    if (blockExists) {
      return res.status(404).send("User not found");
    }

    // If user is private, check if session user is connected
    if (targetUser.isPrivate && sessionUserId !== targetUserId) {
      const connection = await prisma.userConnection.findFirst({
        where: {
          userId: sessionUserId,
          otherUserId: targetUserId,
          type: { in: ["ACQUAINTANCE", "STRANGER"] }
        }
      });

      if (!connection) {
        return res.status(403).send("This user's following list is private");
      }
    }

    // Get all users that the target user is following
    const followingConnections = await prisma.userConnection.findMany({
      where: {
        userId: targetUserId,
        type: "IS_FOLLOWING"
      },
      select: {
        otherUserId: true
      }
    });

    const followingIds = followingConnections.map((fc: any) => fc.otherUserId);

    if (followingIds.length === 0) {
      return res.status(200).json([]);
    }

    // Get blocks involving the session user
    const sessionUserBlocks = await prisma.block.findMany({
      where: {
        OR: [
          { blockerId: sessionUserId },
          { blockedId: sessionUserId }
        ]
      },
      select: {
        blockerId: true,
        blockedId: true
      }
    });

    const blockedUserIds = new Set(
      sessionUserBlocks.map((b: any) => 
        b.blockerId === sessionUserId ? b.blockedId : b.blockerId
      )
    );

    // Filter out blocked users and get user details
    const following = await prisma.user.findMany({
      where: {
        id: { in: followingIds },
        isBanned: false,
        isHidden: false,
        NOT: {
          id: { in: Array.from(blockedUserIds) }
        }
      },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        profilePhoto: true
      },
      orderBy: {
        username: 'asc'
      }
    });

    return res.status(200).json(following);

  } catch (e) {
    console.error("Error fetching following:", e);
    if (e instanceof Error) {
      return res.status(400).json({ error: e.message });
    } else {
      return res.status(400).json({ error: String(e) });
    }
  }
});

export default router;