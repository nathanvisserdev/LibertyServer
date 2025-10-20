
import { Router } from "express";
import { PrismaClient, GroupPrivacy } from "./generated/prisma/index.js";
import { auth } from "./misc.js";

const prisma = new PrismaClient();
const router = Router();

// --- List Groups ---
router.get("/groups", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const userId = me.id;

  // Get all groups with admin and membership information
  const groups = await prisma.groups.findMany({ 
    include: { 
      admin: true,
      members: {
        where: { userId: userId },
        select: { userId: true }
      }
    } 
  });

  // Filter groups based on visibility rules
  const filteredGroups = groups.filter(g => {
    // Filter out PERSONAL groups where the requester is not the admin
    if (g.groupType === "PERSONAL" && g.adminId !== userId) {
      return false;
    }

    // Filter out hidden groups unless the requester is admin or member
    if (g.isHidden) {
      const isAdmin = g.adminId === userId;
      const isMember = g.members.length > 0; // User is a member if found in members array
      
      if (!isAdmin && !isMember) {
        return false;
      }
    }

    return true;
  });

  // Apply displayLabel logic and remove members array from response
  res.json(
    filteredGroups.map(g => {
      const { members, ...groupWithoutMembers } = g;
      
      if (g.groupType === "PUBLIC")
        return { ...groupWithoutMembers, displayLabel: `${g.name} public assembly room` };
      if (g.groupType === "PRIVATE")
        return { ...groupWithoutMembers, displayLabel: `${g.name} private assembly room` };
      return { ...groupWithoutMembers, displayLabel: "Social Circle" };
    })
  );
});

// --- Get Group Members ---
router.get("/groups/:groupId/members", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const userId = me.id;
  const groupId = req.params.groupId;

  if (!groupId) {
    return res.status(400).send("Missing group id");
  }

  try {
    // Get group information
    const group = await prisma.groups.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        groupType: true,
        isHidden: true,
        adminId: true
      }
    });

    if (!group) {
      return res.status(404).send("Group not found");
    }

    // Check if group is PERSONAL and requester is not the admin
    if (group.groupType === "PERSONAL" && group.adminId !== userId) {
      return res.status(403).json({
        error: "FORBIDDEN",
        code: "PERSONAL_OWNER_ONLY",
        message: "Unauthorized users may not access other users personal groups."
      });
    }

    // Check requester's membership status
    const requesterMembership = await prisma.groupRoster.findUnique({
      where: {
        userId_groupId: {
          userId: userId,
          groupId: groupId
        }
      }
    });

    // If requester is banned
    if (requesterMembership && requesterMembership.isBanned) {
      return res.status(403).json({
        error: "FORBIDDEN",
        code: "MEMBER_BANNED_FROM_GROUP"
      });
    }

    // If requester is non-member and group is hidden
    if (!requesterMembership && group.isHidden) {
      return res.status(404).send("Group not found");
    }

    // Check if any member has isHidden = true (non-member case)
    if (!requesterMembership) {
      const hasHiddenMembers = await prisma.groupRoster.findFirst({
        where: {
          groupId: groupId,
          isHidden: true
        }
      });

      if (hasHiddenMembers) {
        const totalCount = await prisma.groupRoster.count({
          where: {
            groupId: groupId,
            isBanned: false
          }
        });

        return res.status(200).json({
          members: [],
          totalCount: totalCount,
          visibility: "HIDDEN"
        });
      }
    }

    // Get all non-banned members
    const members = await prisma.groupRoster.findMany({
      where: {
        groupId: groupId,
        isBanned: false
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      },
      orderBy: {
        joinedAt: 'asc'
      }
    });

    const totalCount = members.length;

    return res.status(200).json({
      members: members.map(member => ({
        membershipId: member.membershipId,
        userId: member.userId,
        joinedAt: member.joinedAt,
        isHidden: member.isHidden,
        user: member.user
      })),
      totalCount: totalCount
    });

  } catch (error) {
    console.error("Error fetching group members:", error);
    res.status(500).send("Internal server error");
  }
});

// --- Join Group Request ---
router.post("/groups/:id/join", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const userId = me.id;
  const groupId = req.params.id;

  if (!groupId) {
    return res.status(400).send("Missing group id");
  }

  try {
    // Check if group exists
    const group = await prisma.groups.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        groupType: true,
        isHidden: true,
        adminId: true
      }
    });

    if (!group) {
      return res.status(404).send("Group not found");
    }

    // Check if group is hidden
    if (group.isHidden) {
      return res.status(404).send("Group not found");
    }

    // Check if group is PERSONAL
    if (group.groupType === "PERSONAL") {
      // If it's the user's own PERSONAL group, return bad request
      if (group.adminId === userId) {
        return res.status(400).send("Cannot request to join your own personal group");
      }
      // If it's someone else's PERSONAL group, return not found
      return res.status(404).send("Group not found");
    }

    // Check if user is already a member
    const existingMembership = await prisma.groupRoster.findUnique({
      where: {
        userId_groupId: {
          userId: userId,
          groupId: groupId
        }
      }
    });

    if (existingMembership) {
      if (existingMembership.isBanned) {
        return res.status(403).send("You are banned from this group");
      }
      return res.status(409).send("You are already a member of this group");
    }

    // Check if there's already a pending join request
    const existingRequest = await prisma.joinGroup.findFirst({
      where: {
        groupId: groupId,
        requesterId: userId,
        status: "PENDING"
      }
    });

    if (existingRequest) {
      return res.status(409).send("You already have a pending join request for this group");
    }

    // Create the join request
    const joinRequest = await prisma.joinGroup.create({
      data: {
        groupId: groupId,
        requesterId: userId,
        status: "PENDING"
      },
      select: {
        id: true,
        groupId: true,
        requesterId: true,
        status: true,
        createdAt: true
      }
    });

    res.status(201).json({
      message: "Join request submitted successfully",
      request: joinRequest
    });
  } catch (error) {
    console.error("Error creating join request:", error);
    res.status(500).send("Internal server error");
  }
});

// --- Create Group ---
router.post("/groups", auth, async (req, res) => {
  const { name, description, groupType, isHidden } = req.body ?? {};
  if (!name) return res.status(400).send("Missing name");

  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;

  // Only allow PUBLIC or PRIVATE for assembly rooms
  const allowed = ["PUBLIC", "PRIVATE"];
  if (!allowed.includes(String(groupType)?.toUpperCase()))
    return res.status(400).send("groupType must be PUBLIC or PRIVATE");

  try {
    // Get user's payment status to check if they can set isHidden
    const user = await prisma.users.findUnique({
      where: { id: me.id },
      select: { isPaid: true }
    });

    if (!user) {
      return res.status(401).send("User not found");
    }

    // Validate isHidden field based on payment status
    let finalIsHidden = false; // Default to false
    if (isHidden === true) {
      if (!user.isPaid) {
        return res.status(402).json({ 
          error: "Premium membership required to create hidden groups" 
        });
      }
      finalIsHidden = true;
    }
    // For unpaid users or when isHidden is not true, always use false

    const group = await prisma.groups.create({
      data: {
        name: String(name),
        description: description ?? null,
        groupType: String(groupType).toUpperCase() as GroupPrivacy,
        isHidden: finalIsHidden,
        adminId: me.id,
      },
      select: {
        id: true,
        name: true,
        groupType: true,
        isHidden: true,
      },
    });
    
    res.status(201).json(group);
  } catch (e) {
    if (e instanceof Error) {
      res.status(400).json({ error: e.message });
    } else {
      res.status(400).json({ error: String(e) });
    }
  }
});

// --- Access a room (no room for PERSONAL) ---
router.get("/groups/:id/room", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = (req.user as any).id;
  if (!req.params.id) return res.status(400).send("Missing group id");
  const g = await prisma.groups.findUnique({ where: { id: req.params.id as string } });
  if (!g) return res.sendStatus(404);

  if (g.groupType === "PERSONAL") return res.status(404).send("no room for social circle");
  if (g.groupType === "PRIVATE") {
    const member = await prisma.groupRoster.findUnique({
      where: { userId_groupId: { userId: me, groupId: g.id } },
    });
    if (!member) return res.sendStatus(403);
  }
  res.json({
    id: g.id,
    forumName:
      g.groupType === "PUBLIC"
        ? `${g.name} public assembly room`
        : `${g.name} private assembly room`,
  });
});

export default router;
