import { Router } from "express";
import { auth } from "./misc.js";
import { prismaClient as prisma } from "./prismaClient.js";
import { sendConnectionNotification } from "./pushNotifications.js";

const router = Router();

// --- GET /connections ---
router.get("/connections", auth, async (req, res) => {
  if (!req.user) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = req.user.id;

  // Pagination parameters
  const limit = parseInt(req.query.limit as string) || 50;
  const cursor = req.query.cursor as string | undefined;
  const typeFilter = req.query.type as string | undefined;

  try {
    // Build where clause
    const whereClause: any = {
      userId: sessionUserId
    };

    // Add type filter if provided
    if (typeFilter && ["ACQUAINTANCE", "STRANGER", "IS_FOLLOWING"].includes(typeFilter)) {
      whereClause.type = typeFilter;
    }

    // Add cursor for pagination
    if (cursor) {
      whereClause.createdAt = { lt: new Date(cursor) };
    }

    // Fetch user connections using adjacency table
    const userConnections = await prisma.userConnection.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            profilePhoto: true
          }
        }
      },
      orderBy: [
        { createdAt: 'desc' },
        { otherUserId: 'asc' }
      ],
      take: limit + 1 // Fetch one extra to determine if there are more results
    });

    // Determine if there are more results
    const hasMore = userConnections.length > limit;
    const results = hasMore ? userConnections.slice(0, limit) : userConnections;

    // Fetch the "other" users' data
    const otherUserIds = results.map((uc: any) => uc.otherUserId);
    const otherUsers = await prisma.user.findMany({
      where: {
        id: { in: otherUserIds }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        profilePhoto: true
      }
    });

    // Create a map for quick lookup
    const otherUsersMap = new Map(otherUsers.map((u: any) => [u.id, u]));

    // Build response
    const connectionsList = results.map((uc: any) => {
      const otherUser = otherUsersMap.get(uc.otherUserId);
      return {
        id: uc.connectionId,
        userId: uc.otherUserId,
        firstName: (otherUser as any)?.firstName || '',
        lastName: (otherUser as any)?.lastName || '',
        username: (otherUser as any)?.username || '',
        profilePhoto: (otherUser as any)?.profilePhoto || '',
        type: uc.type,
        createdAt: uc.createdAt
      };
    });

    // Get next cursor if there are more results
    const nextCursor = hasMore && results.length > 0
      ? results[results.length - 1].createdAt.toISOString()
      : null;

    return res.status(200).json({
      connectionsList,
      nextCursor,
      hasMore
    });

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
      prisma.user.findUnique({
        where: { id: requesterId },
        select: { id: true, isHidden: true, isBanned: true }
      }),
      prisma.user.findUnique({
        where: { id: requestedId },
        select: { id: true, isHidden: true, isBanned: true }
      })
    ]);

    if (!requester || !requested) {
      return res.status(404).send("User not found");
    }

    // Check for existing block between users (bidirectional)
    const blockExists = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: requesterId, blockedId: requestedId },
          { blockerId: requestedId, blockedId: requesterId }
        ]
      }
    });

    // Check for existing connection
    const existingConnection = await prisma.connection.findFirst({
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

    // Send push notification to the requested user
    try {
      console.log(`📬 Sending connection notification to user ${requestedId}`);
      await sendConnectionNotification(requestedId);
      console.log(`✅ Connection notification sent successfully`);
    } catch (notifError) {
      // Log but don't fail the request if notification fails
      console.error("❌ Failed to send connection notification:", notifError);
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

// --- GET /connections/pending/incoming ---
router.get("/connections/pending/incoming", auth, async (req, res) => {
  if (!req.user) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = req.user.id;

  try {
    // Reset pending request count when user views their requests
    await prisma.user.update({
      where: { id: sessionUserId },
      data: { pendingRequestCount: 0 },
    });

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
            profilePhoto: true
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
            profilePhoto: true
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
    const blockExists = await prisma.block.findFirst({
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
    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Update the connection request status to ACCEPTED
      const updatedRequest = await tx.connectionRequest.update({
        where: { id: requestId },
        data: {
          status: "ACCEPTED",
          decidedAt: new Date()
        }
      });

      // 2. Check for existing connection (bidirectional)
      const existingConnection = await tx.connection.findFirst({
        where: {
          OR: [
            { requesterId: connectionRequest.requesterId, requestedId: connectionRequest.requestedId },
            { requesterId: connectionRequest.requestedId, requestedId: connectionRequest.requesterId }
          ]
        }
      });

      let connection;
      const connectionType = connectionRequest.type === "FOLLOW" ? "IS_FOLLOWING" : connectionRequest.type;
      
      if (existingConnection) {
        // Update existing connection with the new type
        connection = await tx.connection.update({
          where: { id: existingConnection.id },
          data: {
            type: connectionType as "ACQUAINTANCE" | "STRANGER" | "IS_FOLLOWING"
          }
        });

        // Delete old adjacency rows for this connection
        await tx.userConnection.deleteMany({
          where: { connectionId: existingConnection.id }
        });
      } else {
        // Create new connection
        connection = await tx.connection.create({
          data: {
            requesterId: connectionRequest.requesterId,
            requestedId: connectionRequest.requestedId,
            type: connectionType as "ACQUAINTANCE" | "STRANGER" | "IS_FOLLOWING"
          }
        });
      }

      // 3. Insert adjacency rows with idempotency
      // IS_FOLLOWING is one-directional (requester follows requested)
      // ACQUAINTANCE and STRANGER are bidirectional
      if (connectionType === "IS_FOLLOWING") {
        // Only create one entry: follower -> followed
        await tx.userConnection.upsert({
          where: {
            userId_otherUserId_type: {
              userId: connectionRequest.requesterId,
              otherUserId: connectionRequest.requestedId,
              type: connectionType as "ACQUAINTANCE" | "STRANGER" | "IS_FOLLOWING"
            }
          },
          create: {
            userId: connectionRequest.requesterId,
            otherUserId: connectionRequest.requestedId,
            connectionId: connection.id,
            type: connectionType as "ACQUAINTANCE" | "STRANGER" | "IS_FOLLOWING"
          },
          update: {
            connectionId: connection.id
          }
        });
      } else {
        // Create both directions for bidirectional connections (ACQUAINTANCE, STRANGER)
        await Promise.all([
          tx.userConnection.upsert({
            where: {
              userId_otherUserId_type: {
                userId: connectionRequest.requesterId,
                otherUserId: connectionRequest.requestedId,
                type: connectionType as "ACQUAINTANCE" | "STRANGER" | "IS_FOLLOWING"
              }
            },
            create: {
              userId: connectionRequest.requesterId,
              otherUserId: connectionRequest.requestedId,
              connectionId: connection.id,
              type: connectionType as "ACQUAINTANCE" | "STRANGER" | "IS_FOLLOWING"
            },
            update: {
              connectionId: connection.id
            }
          }),
          tx.userConnection.upsert({
            where: {
              userId_otherUserId_type: {
                userId: connectionRequest.requestedId,
                otherUserId: connectionRequest.requesterId,
                type: connectionType as "ACQUAINTANCE" | "STRANGER" | "IS_FOLLOWING"
              }
            },
            create: {
              userId: connectionRequest.requestedId,
              otherUserId: connectionRequest.requesterId,
              connectionId: connection.id,
              type: connectionType as "ACQUAINTANCE" | "STRANGER" | "IS_FOLLOWING"
            },
            update: {
              connectionId: connection.id
            }
          })
        ]);
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

// --- POST /connections/:requestId/decline ---
router.post("/connections/:requestId/decline", auth, async (req, res) => {
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
    const blockExists = await prisma.block.findFirst({
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
    const blockExists = await prisma.block.findFirst({
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
    const otherUser = await prisma.user.findUnique({
      where: { id: otherUserId },
      select: { id: true, isHidden: true, isBanned: true }
    });

    if (!otherUser) {
      return res.status(404).send("User not found");
    }

    // Find existing connection (bidirectional)
    const existingConnection = await prisma.connection.findFirst({
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

    // Delete the connection and adjacency rows in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Delete both adjacency rows
      await tx.userConnection.deleteMany({
        where: {
          connectionId: existingConnection.id
        }
      });

      // 2. Delete the connection
      await tx.connection.delete({
        where: { id: existingConnection.id }
      });

      return existingConnection;
    });

    return res.status(200).json({
      message: "Connection deleted successfully",
      deletedConnectionId: result.id,
      otherUserId: otherUserId
    });

  } catch (error) {
    console.error("Delete connection error:", error);
    return res.status(500).send("Internal server error");
  }
});

export default router;
