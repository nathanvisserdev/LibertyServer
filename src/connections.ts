import { Router } from "express";
import { PrismaClient } from "./generated/prisma/index.js";
import { auth } from "./misc.js";

const prisma = new PrismaClient();
const router = Router();

// --- POST /connections/request ---
router.post("/connections/request", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const requesterId = (req.user as any).id;
  const { requestedId, requestType } = req.body ?? {};

  // Validate input
  if (!requestedId || typeof requestedId !== "string") {
    return res.status(400).send("Invalid requestedId");
  }
  if (!requestType || !["ACQUAINTANCE", "STRANGER"].includes(requestType)) {
    return res.status(400).send("Invalid requestType: must be ACQUAINTANCE or STRANGER");
  }
  if (requesterId === requestedId) {
    return res.status(400).send("Cannot create connection request to yourself");
  }

  try {
    // Fetch both users
    const [requester, requested] = await Promise.all([
      prisma.users.findUnique({
        where: { id: requesterId },
        select: { id: true, isHidden: true, isBanned: true }
      }),
      prisma.users.findUnique({
        where: { id: requestedId },
        select: { id: true, isHidden: true, isBanned: true }
      })
    ]);

    if (!requester || !requested) {
      return res.status(404).send("User not found");
    }

    // Check for existing block between users (bidirectional)
    const blockExists = await prisma.blocks.findFirst({
      where: {
        OR: [
          { blockerId: requesterId, blockedId: requestedId },
          { blockerId: requestedId, blockedId: requesterId }
        ]
      }
    });

    // Check for existing connection
    const existingConnection = await prisma.connections.findFirst({
      where: {
        OR: [
          { requesterId: requesterId, requestedId: requestedId },
          { requesterId: requestedId, requestedId: requesterId }
        ]
      }
    });

    // Define booleans exactly as specified
    const isBlocked = blockExists !== null;
    const isHidden = requester.isHidden || requested.isHidden;
    const isBanned = requester.isBanned || requested.isBanned;

    // Control flow as specified
    if (isBlocked || isHidden || isBanned) {
      return res.status(404).send("User not found");
    } else if (existingConnection && existingConnection.type === "ACQUAINTANCE") {
      return res.status(409).json({
        error: "The request can't proceed because the relationship already exists in that state."
      });
    } else if (existingConnection && existingConnection.type === "STRANGER") {
      // Allow only incoming requestType === "ACQUAINTANCE" and reject any other
      if (requestType !== "ACQUAINTANCE") {
        return res.status(409).json({
          error: "Invalid request type for existing relationship"
        });
      }
    } else if (existingConnection && existingConnection.type === "IS_FOLLOWING") {
      // Allow only requestType in { "STRANGER", "ACQUAINTANCE" } and reject others
      if (!["STRANGER", "ACQUAINTANCE"].includes(requestType)) {
        return res.status(409).json({
          error: "Invalid request type for existing relationship"
        });
      }
    } else if (!existingConnection) {
      // Allow any requestType when not connected - this is handled below
    } else {
      return res.status(500).send("Internal server error");
    }

    // Create or update the pending connection-request row
    // First check if a pending request already exists
    const existingRequest = await prisma.connectionRequest.findFirst({
      where: {
        requesterId: requesterId,
        requestedId: requestedId,
        status: "PENDING"
      }
    });

    let connectionRequest;
    if (existingRequest) {
      // Update existing request
      connectionRequest = await prisma.connectionRequest.update({
        where: { id: existingRequest.id },
        data: {
          type: requestType as "ACQUAINTANCE" | "STRANGER",
          createdAt: new Date()
        }
      });
    } else {
      // Create new request
      connectionRequest = await prisma.connectionRequest.create({
        data: {
          requesterId: requesterId,
          requestedId: requestedId,
          type: requestType as "ACQUAINTANCE" | "STRANGER",
          status: "PENDING"
        }
      });
    }

    return res.status(201).json({
      requesterId: connectionRequest.requesterId,
      requestedId: connectionRequest.requestedId,
      requestType: connectionRequest.type
    });

  } catch (error) {
    console.error("Connection request error:", error);
    return res.status(500).send("Internal server error");
  }
});

export default router;
