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
  if (!requestType || !["ACQUAINTANCE", "STRANGER", "FOLLOW"].includes(requestType)) {
    return res.status(400).send("Invalid requestType: must be ACQUAINTANCE, STRANGER, or FOLLOW");
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

    // Define booleans for 404 response types
    const isBlocked = blockExists !== null;
    const isHidden = requester.isHidden || requested.isHidden;
    const isBanned = requester.isBanned || requested.isBanned;

    // Control flow as specified
    if (isBlocked || isHidden || isBanned) {
      return res.status(404).send("User not found");
    } else if (existingConnection && existingConnection.type === "ACQUAINTANCE") {
      // ACQUAINTANCE is the highest level - reject ALL request types
      if (requestType === "ACQUAINTANCE") {
        return res.status(409).json({
          error: "The request can't proceed because the relationship already exists in that state."
        });
      } else {
        // Reject STRANGER and FOLLOW requests (would be downgrades)
        return res.status(409).json({
          error: "Invalid request type for existing relationship"
        });
      }
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

    // Create or update the pending connection-request row using unique constraint
    const connectionRequest = await prisma.connectionRequest.upsert({
      where: {
        requesterId_requestedId: {
          requesterId: requesterId,
          requestedId: requestedId
        }
      },
      update: {
        type: requestType as "ACQUAINTANCE" | "STRANGER" | "FOLLOW",
        status: "PENDING",
        createdAt: new Date(),
        decidedAt: null
      },
      create: {
        requesterId: requesterId,
        requestedId: requestedId,
        type: requestType as "ACQUAINTANCE" | "STRANGER" | "FOLLOW",
        status: "PENDING"
      }
    });

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

// --- GET /connections/pending/incoming ---
router.get("/connections/pending/incoming", auth, async (req, res) => {
  if (!req.user) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = req.user.id;

  try {
    const incomingRequests: any[] = [];

    // Fetch all PENDING connection requests where session user is the requested user
    const pendingRequests = await prisma.connectionRequest.findMany({
      where: {
        requestedId: sessionUserId,
        status: "PENDING"
      },
      include: {
        requester: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            photo: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Add all matching requests to incomingRequests array
    for (const request of pendingRequests) {
      if (request.requestedId === sessionUserId && request.status === "PENDING") {
        incomingRequests.push({
          id: request.id,
          requesterId: request.requesterId,
          requestedId: request.requestedId,
          type: request.type,
          status: request.status,
          createdAt: request.createdAt,
          requester: request.requester
        });
      }
    }

    return res.status(200).json({ incomingRequests });

  } catch (error) {
    console.error("Get pending connections error:", error);
    return res.status(500).send("Internal server error");
  }
});

// --- GET /connections/pending/outgoing ---
router.get("/connections/pending/outgoing", auth, async (req, res) => {
  if (!req.user) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = req.user.id;

  try {
    const outgoingRequests: any[] = [];

    // Fetch all PENDING connection requests where session user is the requester
    const pendingRequests = await prisma.connectionRequest.findMany({
      where: {
        requesterId: sessionUserId,
        status: "PENDING"
      },
      include: {
        requested: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            photo: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Add all matching requests to outgoingRequests array
    for (const request of pendingRequests) {
      if (request.requesterId === sessionUserId && request.status === "PENDING") {
        outgoingRequests.push({
          id: request.id,
          requesterId: request.requesterId,
          requestedId: request.requestedId,
          type: request.type,
          status: request.status,
          createdAt: request.createdAt,
          requested: request.requested
        });
      }
    }

    return res.status(200).json({ outgoingRequests });

  } catch (error) {
    console.error("Get pending connections error:", error);
    return res.status(500).send("Internal server error");
  }
});

export default router;
