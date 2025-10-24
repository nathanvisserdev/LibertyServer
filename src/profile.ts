import { Router } from "express";
import { auth } from "./misc.js";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();

// --- View a user's profile (with privacy and relationship-based visibility) ---
router.get("/users/:id", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = (req.user as any).id;
  const targetUserId = req.params.id;

  if (!targetUserId) {
    return res.status(400).send("Missing user ID");
  }

  try {
    // Get the target user with basic info
    const targetUser = await prisma.users.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        profilePhoto: true,
        about: true,
        gender: true,
        isPrivate: true,
        isHidden: true,
        isBanned: true,
      },
    });

    if (!targetUser) {
      return res.status(404).send("User not found");
    }

    // Check if user is banned or hidden
    if (targetUser.isBanned || targetUser.isHidden) {
      return res.status(404).send("User not found");
    }

    // Check if the session user has blocked the target user or vice versa
    const blockExists = await prisma.blocks.findFirst({
      where: {
        OR: [
          { blockerId: sessionUserId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: sessionUserId },
        ],
      },
    });

    if (blockExists) {
      return res.status(404).send("User not found");
    }

    // Check if users are connected (acquaintances, strangers, or follow relationship)
    const connection = await prisma.connections.findFirst({
      where: {
        OR: [
          { 
            requesterId: sessionUserId, 
            requestedId: targetUserId,
            type: { in: ["ACQUAINTANCE", "STRANGER", "IS_FOLLOWING"] }
          },
          { 
            requesterId: targetUserId, 
            requestedId: sessionUserId,
            type: { in: ["ACQUAINTANCE", "STRANGER", "IS_FOLLOWING"] }
          },
        ],
      },
    });

    const isConnected = !!connection;
    const connectionStatus = connection?.type || null;

    // Check for pending connection request from session user to target user
    const pendingConnectionRequest = await prisma.connectionRequest.findFirst({
      where: {
        requesterId: sessionUserId,
        requestedId: targetUserId,
        status: "PENDING"
      }
    });

    const pendingRequest = !!pendingConnectionRequest;
    const requestType = pendingRequest ? pendingConnectionRequest.type : null;

    // Build response based on privacy and connection status
    if (isConnected || !targetUser.isPrivate) {
      // Connected or target is not private - show extended profile
      console.log("📸 Returning profile with photo:", targetUser.profilePhoto);
      return res.status(200).json({
        id: targetUser.id,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        username: targetUser.username,
        gender: targetUser.gender,
        profilePhoto: targetUser.profilePhoto,
        about: targetUser.about,
        connectionStatus: connectionStatus,
        requestType: requestType,
      });
    } else {
      // Target is private and not connected - show minimal profile
      console.log("📸 Returning minimal profile with photo:", targetUser.profilePhoto);
      return res.status(200).json({
        id: targetUser.id,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        username: targetUser.username,
        profilePhoto: targetUser.profilePhoto,
        connectionStatus: connectionStatus,
        requestType: requestType,
      });
    }

  } catch (e) {
    console.error("Error fetching user profile:", e);
    if (e instanceof Error) {
      return res.status(400).json({ error: e.message });
    } else {
      return res.status(400).json({ error: String(e) });
    }
  }
});

export default router;
