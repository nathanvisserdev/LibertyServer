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

// --- Add Member to SubNet ---
router.post("/subnets/:id/members", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  
  const ownerId = (req.user as any).id;
  const { id: subNetId } = req.params;
  const { userId, role } = req.body;

  // Validate required fields
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "userId is required" });
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

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, firstName: true, lastName: true }
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Cannot add yourself as a member (you're already the owner)
    if (userId === ownerId) {
      return res.status(400).json({ error: "Cannot add yourself as a member (you are the owner)" });
    }

    // Check if member already exists
    const existingMember = await prisma.subNetMember.findUnique({
      where: {
        subNetId_userId: {
          subNetId,
          userId
        }
      }
    });

    if (existingMember) {
      return res.status(400).json({ error: "User is already a member of this subnet" });
    }

    // Find the connection between owner and the user to be added
    // SubNetMember requires a valid connectionId
    // For mutual connections (ACQUAINTANCE, STRANGER): requesterId=min(userId), requestedId=max(userId)
    // For follows (IS_FOLLOWING): requesterId=followerId, requestedId=userId
    
    const connections = await prisma.connection.findMany({
      where: {
        OR: [
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
        ]
      }
    });

    if (connections.length === 0) {
      return res.status(400).json({ 
        error: "Cannot add user to subnet. User must be connected to you (acquaintance, stranger, or follower)" 
      });
    }

    // Use the first connection found (prefer mutual connections over follows)
    const connection = connections.find((c: any) => c.type !== "IS_FOLLOWING") || connections[0];

    // Create the subnet member
    const member = await prisma.$transaction(async (tx: any) => {
      const newMember = await tx.subNetMember.create({
        data: {
          subNetId,
          userId,
          connectionId: connection.id,
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
      });

      // Increment memberCount
      await tx.subNet.update({
        where: { id: subNetId },
        data: {
          memberCount: { increment: 1 }
        }
      });

      return newMember;
    });

    res.status(201).json(member);
  } catch (error) {
    console.error("Error adding subnet member:", error);
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
