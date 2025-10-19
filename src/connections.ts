import { Router } from "express";
import { PrismaClient } from "./generated/prisma/index.js";
import { auth } from "./misc.js";

const prisma = new PrismaClient();
const router = Router();

// --- GET /connections ---
router.get("/connections", auth, async (req, res) => {
  if (!req.user) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = req.user.id;

  try {
    const connectionsList: any[] = [];

    // Fetch all connections where session user is either requester or requested
    const connections = await prisma.connections.findMany({
      where: {
        OR: [
          { requesterId: sessionUserId },
          { requestedId: sessionUserId }
        ]
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
        },
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
        since: 'desc'
      }
    });

    // Process each connection to include the other user's info
    for (const connection of connections) {
      // Determine which user is the "other" user (not the session user)
      const isRequester = connection.requesterId === sessionUserId;
      const otherUser = isRequester ? connection.requested : connection.requester;

      connectionsList.push({
        id: connection.id,
        userId: otherUser.id,
        firstName: otherUser.firstName,
        lastName: otherUser.lastName,
        username: otherUser.username,
        photo: otherUser.photo,
        type: connection.type,
        createdAt: connection.since
      });
    }

    return res.status(200).json({ connectionsList });

  } catch (error) {
    console.error("Get connections error:", error);
    return res.status(500).send("Internal server error");
  }
});

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

// --- POST /connections/:requestId/accept ---
router.post("/connections/:requestId/accept", auth, async (req, res) => {
  if (!req.user) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = req.user.id;
  const { requestId } = req.params;

  // Validate requestId
  if (!requestId || typeof requestId !== "string") {
    return res.status(400).send("Invalid requestId");
  }

  try {
    // Find the connection request
    const connectionRequest = await prisma.connectionRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { id: true, isHidden: true, isBanned: true } },
        requested: { select: { id: true, isHidden: true, isBanned: true } }
      }
    });

    if (!connectionRequest) {
      return res.status(404).send("Connection request not found");
    }

    // Verify that the session user is the requested user (can only accept requests made to you)
    if (connectionRequest.requestedId !== sessionUserId) {
      return res.status(403).send("You can only accept requests made to you");
    }

    // Verify request is still pending
    if (connectionRequest.status !== "PENDING") {
      return res.status(409).send("Connection request is not pending");
    }

    // Check if either user is banned or hidden
    if (connectionRequest.requester.isBanned || connectionRequest.requested.isBanned ||
        connectionRequest.requester.isHidden || connectionRequest.requested.isHidden) {
      return res.status(404).send("User not found");
    }

    // Check for existing block between users (bidirectional)
    const blockExists = await prisma.blocks.findFirst({
      where: {
        OR: [
          { blockerId: connectionRequest.requesterId, blockedId: connectionRequest.requestedId },
          { blockerId: connectionRequest.requestedId, blockedId: connectionRequest.requesterId }
        ]
      }
    });

    if (blockExists) {
      return res.status(404).send("User not found");
    }

    // Use transaction to update request status and handle connection
    const result = await prisma.$transaction(async (tx) => {
      // 1. Update the connection request status to ACCEPTED
      const updatedRequest = await tx.connectionRequest.update({
        where: { id: requestId },
        data: {
          status: "ACCEPTED",
          decidedAt: new Date()
        }
      });

      // 2. Check for existing connection (bidirectional)
      const existingConnection = await tx.connections.findFirst({
        where: {
          OR: [
            { requesterId: connectionRequest.requesterId, requestedId: connectionRequest.requestedId },
            { requesterId: connectionRequest.requestedId, requestedId: connectionRequest.requesterId }
          ]
        }
      });

      let connection;
      if (existingConnection) {
        // Update existing connection with the new type
        const connectionType = connectionRequest.type === "FOLLOW" ? "IS_FOLLOWING" : connectionRequest.type;
        connection = await tx.connections.update({
          where: { id: existingConnection.id },
          data: {
            type: connectionType as "ACQUAINTANCE" | "STRANGER" | "IS_FOLLOWING"
          }
        });
      } else {
        // Create new connection
        const connectionType = connectionRequest.type === "FOLLOW" ? "IS_FOLLOWING" : connectionRequest.type;
        connection = await tx.connections.create({
          data: {
            requesterId: connectionRequest.requesterId,
            requestedId: connectionRequest.requestedId,
            type: connectionType as "ACQUAINTANCE" | "STRANGER" | "IS_FOLLOWING"
          }
        });
      }

      return { updatedRequest, connection };
    });

    return res.status(200).json({
      message: "Connection request accepted",
      requestId: result.updatedRequest.id,
      connectionId: result.connection.id,
      type: result.connection.type
    });

  } catch (error) {
    console.error("Accept connection request error:", error);
    return res.status(500).send("Internal server error");
  }
});

// --- DELETE /connections/:requestId/decline ---
router.delete("/connections/:requestId/decline", auth, async (req, res) => {
  if (!req.user) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = req.user.id;
  const { requestId } = req.params;

  // Validate requestId
  if (!requestId || typeof requestId !== "string") {
    return res.status(400).send("Invalid requestId");
  }

  try {
    // Find the connection request
    const connectionRequest = await prisma.connectionRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { id: true, isHidden: true, isBanned: true } },
        requested: { select: { id: true, isHidden: true, isBanned: true } }
      }
    });

    if (!connectionRequest) {
      return res.status(404).send("Connection request not found");
    }

    // Verify that the session user is the requested user (can only decline requests made to you)
    if (connectionRequest.requestedId !== sessionUserId) {
      return res.status(403).send("You can only decline requests made to you");
    }

    // Verify request is still pending
    if (connectionRequest.status !== "PENDING") {
      return res.status(409).send("Connection request is not pending");
    }

    // Check if either user is banned or hidden
    if (connectionRequest.requester.isBanned || connectionRequest.requested.isBanned ||
        connectionRequest.requester.isHidden || connectionRequest.requested.isHidden) {
      return res.status(404).send("User not found");
    }

    // Check for existing block between users (bidirectional)
    const blockExists = await prisma.blocks.findFirst({
      where: {
        OR: [
          { blockerId: connectionRequest.requesterId, blockedId: connectionRequest.requestedId },
          { blockerId: connectionRequest.requestedId, blockedId: connectionRequest.requesterId }
        ]
      }
    });

    if (blockExists) {
      return res.status(404).send("User not found");
    }

    // Update the connection request status to DECLINED
    const updatedRequest = await prisma.connectionRequest.update({
      where: { id: requestId },
      data: {
        status: "DECLINED",
        decidedAt: new Date()
      }
    });

    return res.status(200).json({
      message: "Connection request declined",
      requestId: updatedRequest.id,
      status: updatedRequest.status
    });

  } catch (error) {
    console.error("Decline connection request error:", error);
    return res.status(500).send("Internal server error");
  }
});

// --- DELETE /connections/:requestId/cancel ---
router.delete("/connections/:requestId/cancel", auth, async (req, res) => {
  if (!req.user) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = req.user.id;
  const { requestId } = req.params;

  // Validate requestId
  if (!requestId || typeof requestId !== "string") {
    return res.status(400).send("Invalid requestId");
  }

  try {
    // Find the connection request
    const connectionRequest = await prisma.connectionRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { id: true, isHidden: true, isBanned: true } },
        requested: { select: { id: true, isHidden: true, isBanned: true } }
      }
    });

    if (!connectionRequest) {
      return res.status(404).send("Connection request not found");
    }

    // Verify that the session user is the requester (can only cancel requests you sent)
    if (connectionRequest.requesterId !== sessionUserId) {
      return res.status(403).send("You can only cancel requests you sent");
    }

    // Verify request is still pending
    if (connectionRequest.status !== "PENDING") {
      return res.status(409).send("Connection request is not pending");
    }

    // Check if either user is banned or hidden
    if (connectionRequest.requester.isBanned || connectionRequest.requested.isBanned ||
        connectionRequest.requester.isHidden || connectionRequest.requested.isHidden) {
      return res.status(404).send("User not found");
    }

    // Check for existing block between users (bidirectional)
    const blockExists = await prisma.blocks.findFirst({
      where: {
        OR: [
          { blockerId: connectionRequest.requesterId, blockedId: connectionRequest.requestedId },
          { blockerId: connectionRequest.requestedId, blockedId: connectionRequest.requesterId }
        ]
      }
    });

    if (blockExists) {
      return res.status(404).send("User not found");
    }

    // Update the connection request status to CANCELED
    const updatedRequest = await prisma.connectionRequest.update({
      where: { id: requestId },
      data: {
        status: "CANCELED",
        decidedAt: new Date()
      }
    });

    return res.status(200).json({
      message: "Connection request canceled",
      requestId: updatedRequest.id,
      status: updatedRequest.status
    });

  } catch (error) {
    console.error("Cancel connection request error:", error);
    return res.status(500).send("Internal server error");
  }
});

// --- DELETE /connections/:id ---
router.delete("/connections/:id", auth, async (req, res) => {
  if (!req.user) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = req.user.id;
  const { id: otherUserId } = req.params;

  // Validate otherUserId
  if (!otherUserId || typeof otherUserId !== "string" || otherUserId.trim() === "") {
    return res.status(400).send("Invalid user ID");
  }

  // Cannot delete connection to yourself
  if (sessionUserId === otherUserId) {
    return res.status(400).send("Cannot delete connection to yourself");
  }

  try {
    // Check if the other user exists
    const otherUser = await prisma.users.findUnique({
      where: { id: otherUserId },
      select: { id: true, isHidden: true, isBanned: true }
    });

    if (!otherUser) {
      return res.status(404).send("User not found");
    }

    // Find existing connection (bidirectional)
    const existingConnection = await prisma.connections.findFirst({
      where: {
        OR: [
          { requesterId: sessionUserId, requestedId: otherUserId },
          { requesterId: otherUserId, requestedId: sessionUserId }
        ]
      }
    });

    if (!existingConnection) {
      return res.status(404).send("Connection not found");
    }

    // Delete the connection
    await prisma.connections.delete({
      where: { id: existingConnection.id }
    });

    return res.status(200).json({
      message: "Connection deleted successfully",
      deletedConnectionId: existingConnection.id,
      otherUserId: otherUserId
    });

  } catch (error) {
    console.error("Delete connection error:", error);
    return res.status(500).send("Internal server error");
  }
});

export default router;
