import { Router } from "express";
import { SubNetRole } from "./generated/prisma/index.js";
import { auth } from "./misc.js";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();

// --- Get Members of a SubNet ---
router.get("/me/subnets/:subnetId/members", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  
  const ownerId = (req.user as any).id;
  const { subnetId } = req.params;

  try {
    // Check if subnet exists and belongs to the authenticated user
    const subnet = await prisma.subNet.findUnique({
      where: { id: subnetId },
      select: { ownerId: true }
    });

    if (!subnet) {
      return res.status(404).json({ error: "Subnet not found" });
    }

    if (subnet.ownerId !== ownerId) {
      return res.status(403).json({ error: "You do not have permission to view this subnet's members" });
    }

    // Fetch all members of the subnet
    const members = await prisma.subNetMember.findMany({
      where: {
        subNetId: subnetId
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePhoto: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    res.json(members);
  } catch (error) {
    console.error("Error fetching subnet members:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Get Eligible Connections for SubNet ---
router.get("/me/subnets/:subnetId/eligible-connections", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  
  const userId = (req.user as any).id;
  const { subnetId } = req.params;

  try {
    // Check if subnet exists and belongs to the authenticated user
    const subnet = await prisma.subNet.findUnique({
      where: { id: subnetId },
      select: { ownerId: true }
    });

    if (!subnet) {
      return res.status(404).json({ error: "Subnet not found" });
    }

    if (subnet.ownerId !== userId) {
      return res.status(403).json({ error: "You do not have permission to view this subnet" });
    }

    // Get all existing member user IDs for this subnet
    const existingMembers = await prisma.subNetMember.findMany({
      where: { subNetId: subnetId },
      select: { userId: true }
    });

    const existingMemberIds = existingMembers.map((m: any) => m.userId);
    // Also exclude the owner themselves
    existingMemberIds.push(userId);

    // Fetch user connections using adjacency table
    const userConnections = await prisma.userConnection.findMany({
      where: {
        userId: userId,
        otherUserId: { notIn: existingMemberIds }
      },
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
      ]
    });

    // Fetch the "other" users' data
    const otherUserIds = userConnections.map((uc: any) => uc.otherUserId);
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
    const eligibleConnections = userConnections.map((uc: any) => {
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

    return res.status(200).json(eligibleConnections);

  } catch (error) {
    console.error("Error fetching eligible connections:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Add Member(s) to SubNet ---
router.post("/subnets/:id/members", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  
  const ownerId = (req.user as any).id;
  const { id: subNetId } = req.params;
  const { userId, userIds, role } = req.body;

  // Support both single userId and batch userIds
  let userIdsToAdd: string[] = [];
  
  if (userIds && Array.isArray(userIds)) {
    // Batch mode
    userIdsToAdd = userIds;
  } else if (userId && typeof userId === "string") {
    // Single mode
    userIdsToAdd = [userId];
  } else {
    return res.status(400).json({ error: "Either userId or userIds is required" });
  }

  // Validate all userIds are strings
  if (!userIdsToAdd.every((id: any) => typeof id === "string")) {
    return res.status(400).json({ error: "All user IDs must be strings" });
  }

  // Remove duplicates
  userIdsToAdd = [...new Set(userIdsToAdd)];

  if (userIdsToAdd.length === 0) {
    return res.status(400).json({ error: "At least one userId is required" });
  }

  // Validate role if provided
  if (role) {
    const validRoles: SubNetRole[] = ["OWNER", "MANAGER", "CONTRIBUTOR", "VIEWER"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role value" });
    }
    
    // Prevent assigning OWNER role (only the subnet owner is OWNER)
    if (role === "OWNER") {
      return res.status(400).json({ error: "Cannot assign OWNER role to members" });
    }
  }

  try {
    // Check if subnet exists and belongs to the authenticated user
    const subnet = await prisma.subNet.findUnique({
      where: { id: subNetId },
      select: { ownerId: true, name: true }
    });

    if (!subnet) {
      return res.status(404).json({ error: "Subnet not found" });
    }

    if (subnet.ownerId !== ownerId) {
      return res.status(403).json({ error: "You do not have permission to manage this subnet" });
    }

    // Check if any user is the owner
    if (userIdsToAdd.includes(ownerId)) {
      return res.status(400).json({ error: "Cannot add yourself as a member (you are the owner)" });
    }

    // Check if users exist
    const users = await prisma.user.findMany({
      where: { id: { in: userIdsToAdd } },
      select: { id: true, username: true, firstName: true, lastName: true }
    });

    if (users.length !== userIdsToAdd.length) {
      const foundIds = users.map((u: any) => u.id);
      const missingIds = userIdsToAdd.filter((id: string) => !foundIds.includes(id));
      return res.status(404).json({ 
        error: "One or more users not found",
        missingUserIds: missingIds
      });
    }

    // Check for existing members
    const existingMembers = await prisma.subNetMember.findMany({
      where: {
        subNetId,
        userId: { in: userIdsToAdd }
      },
      select: { userId: true }
    });

    if (existingMembers.length > 0) {
      const existingUserIds = existingMembers.map((m: any) => m.userId);
      return res.status(409).json({ 
        error: "One or more users are already members of this subnet",
        existingUserIds: existingUserIds
      });
    }

    // Find connections for all users
    const connections = await prisma.connection.findMany({
      where: {
        OR: userIdsToAdd.flatMap((userId: string) => [
          // Mutual connections where owner is requester
          {
            requesterId: ownerId,
            requestedId: userId,
            type: { in: ["ACQUAINTANCE", "STRANGER"] }
          },
          // Mutual connections where owner is requested
          {
            requesterId: userId,
            requestedId: ownerId,
            type: { in: ["ACQUAINTANCE", "STRANGER"] }
          },
          // Following relationship where user follows owner
          {
            requesterId: userId,
            requestedId: ownerId,
            type: "IS_FOLLOWING"
          },
          // Following relationship where owner follows user
          {
            requesterId: ownerId,
            requestedId: userId,
            type: "IS_FOLLOWING"
          }
        ])
      }
    });

    // Create a map of userId to connectionId
    const connectionMap = new Map<string, string>();
    userIdsToAdd.forEach((userId: string) => {
      const userConnections = connections.filter((c: any) => 
        (c.requesterId === ownerId && c.requestedId === userId) ||
        (c.requesterId === userId && c.requestedId === ownerId)
      );
      
      if (userConnections.length > 0) {
        // Prefer mutual connections over follows
        const connection = userConnections.find((c: any) => c.type !== "IS_FOLLOWING") || userConnections[0];
        connectionMap.set(userId, connection.id);
      }
    });

    // Check if all users have connections
    const usersWithoutConnection = userIdsToAdd.filter((id: string) => !connectionMap.has(id));
    if (usersWithoutConnection.length > 0) {
      return res.status(400).json({ 
        error: "Cannot add users to subnet. All users must be connected to you (acquaintance, stranger, or follower)",
        usersWithoutConnection
      });
    }

    // Create the subnet members
    const members = await prisma.$transaction(async (tx: any) => {
      const newMembers = await Promise.all(
        userIdsToAdd.map((userId: string) =>
          tx.subNetMember.create({
            data: {
              subNetId,
              userId,
              connectionId: connectionMap.get(userId)!,
              role: role || "VIEWER"
            },
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true
                }
              },
              subNet: {
                select: {
                  id: true,
                  name: true,
                  slug: true
                }
              }
            }
          })
        )
      );

      // Increment memberCount by the number of members added
      await tx.subNet.update({
        where: { id: subNetId },
        data: {
          memberCount: { increment: userIdsToAdd.length }
        }
      });

      return newMembers;
    });

    // Return single member for single add, array for batch add
    res.status(201).json(userIds ? members : members[0]);
  } catch (error) {
    console.error("Error adding subnet member(s):", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Remove Member from SubNet ---
router.delete("/subnets/:id/members/:userId", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  
  const ownerId = (req.user as any).id;
  const { id: subNetId, userId } = req.params;

  try {
    // Check if subnet exists and belongs to the authenticated user
    const subnet = await prisma.subNet.findUnique({
      where: { id: subNetId },
      select: { ownerId: true }
    });

    if (!subnet) {
      return res.status(404).json({ error: "Subnet not found" });
    }

    if (subnet.ownerId !== ownerId) {
      return res.status(403).json({ error: "You do not have permission to manage this subnet" });
    }

    // Cannot remove yourself (you're the owner, not a member)
    if (userId === ownerId) {
      return res.status(400).json({ error: "Cannot remove yourself (you are the owner)" });
    }

    // Check if member exists
    const member = await prisma.subNetMember.findUnique({
      where: {
        subNetId_userId: {
          subNetId,
          userId
        }
      }
    });

    if (!member) {
      return res.status(404).json({ error: "Member not found in this subnet" });
    }

    // Delete the member and decrement count
    await prisma.$transaction(async (tx: any) => {
      await tx.subNetMember.delete({
        where: {
          subNetId_userId: {
            subNetId,
            userId
          }
        }
      });

      // Decrement memberCount
      await tx.subNet.update({
        where: { id: subNetId },
        data: {
          memberCount: { decrement: 1 }
        }
      });
    });

    res.status(204).send();
  } catch (error) {
    console.error("Error removing subnet member:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
