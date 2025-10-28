
import { Router } from "express";
import { GroupPrivacy } from "./generated/prisma/index.js";
import { auth } from "./misc.js";
import { prismaClient as prisma } from "./prismaClient.js";
const router = Router();

// --- List Groups ---
router.get("/groups", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const userId = me.id;

  try {
    // Get all groups with admin and membership information
    const groups = await prisma.groups.findMany({ 
      include: { 
        admin: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true
          }
        },
        members: {
          where: { userId: userId },
          select: { userId: true }
        }
      } 
    });

    // Filter groups based on visibility rules
    const filteredGroups = groups.filter(g => {
      // Safety checks
      if (!g || !g.adminId || !g.groupType) {
        return false;
      }

      // Filter out PERSONAL groups where the requester is not the admin
      if (g.groupType === "PERSONAL" && g.adminId !== userId) {
        return false;
      }

      // Filter out hidden groups unless the requester is admin or member
      if (g.isHidden) {
        const isAdmin = g.adminId === userId;
        const isMember = (g.members && g.members.length > 0) || false; // User is a member if found in members array
        
        if (!isAdmin && !isMember) {
          return false;
        }
      }

      return true;
    });

    // Apply displayLabel logic and remove members array from response
    res.json(
      filteredGroups.map(g => {
        const { members, ...groupWithoutMembers } = g || {};
        
        // Safety check for group name
        const groupName = g?.name || "Unknown Group";
        
        if (g?.groupType === "PUBLIC")
          return { ...groupWithoutMembers, displayLabel: `${groupName} public assembly room` };
        if (g?.groupType === "PRIVATE")
          return { ...groupWithoutMembers, displayLabel: `${groupName} private assembly room` };
        return { ...groupWithoutMembers, displayLabel: "Social Circle" };
      })
    );
  } catch (error) {
    console.error("Error in GET /groups:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Get Groups with Mutual Connections ---
router.get("/groups/mutuals", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const userId = me.id;

  try {
    // Get user's connections (all types: ACQUAINTANCE, STRANGER, IS_FOLLOWING)
    const connections = await prisma.connections.findMany({
      where: {
        OR: [
          { requesterId: userId },
          { requestedId: userId }
        ]
      },
      include: {
        requester: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            isHidden: true,
            isBanned: true
          }
        },
        requested: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            isHidden: true,
            isBanned: true
          }
        }
      }
    });

    // Extract connection user IDs (excluding current user)
    const connectionUserIds = connections
      .map(conn => conn.requesterId === userId ? conn.requestedId : conn.requesterId)
      .filter(id => id !== userId);

    if (connectionUserIds.length === 0) {
      return res.json([]);
    }

    // Get blocks to filter out blocked users
    const blocks = await prisma.blocks.findMany({
      where: {
        OR: [
          { blockerId: userId },
          { blockedId: userId }
        ]
      }
    });

    const blockedUserIds = new Set(
      blocks.map(block => 
        block.blockerId === userId ? block.blockedId : block.blockerId
      )
    );

    // Filter connections to exclude hidden, banned, or blocked users
    const validConnectionUserIds = connectionUserIds.filter(connId => {
      if (blockedUserIds.has(connId)) return false;
      
      const connection = connections.find(conn => 
        (conn.requesterId === userId && conn.requestedId === connId) ||
        (conn.requestedId === userId && conn.requesterId === connId)
      );
      
      if (!connection) return false;
      
      const connectedUser = connection.requesterId === userId ? connection.requested : connection.requester;
      
      // Exclude hidden or banned users
      if (connectedUser.isHidden || connectedUser.isBanned) return false;
      
      return true;
    });

    if (validConnectionUserIds.length === 0) {
      return res.json([]);
    }

    // Get groups where user is not banned
    const userBannedGroups = await prisma.groupMember.findMany({
      where: {
        userId: userId,
        isBanned: true
      },
      select: { groupId: true }
    });

    const bannedGroupIds = new Set(userBannedGroups.map(roster => roster.groupId));

    // Find groups that have valid connections as members
    const groupsWithMembers = await prisma.groups.findMany({
      where: {
        AND: [
          { isHidden: false },
          { membershipHidden: false },
          { groupType: { notIn: ["PERSONAL"] } }, // Exclude personal groups
          { 
            NOT: {
              id: { in: Array.from(bannedGroupIds) }
            }
          },
          {
            members: {
              some: {
                userId: { in: validConnectionUserIds },
                isBanned: false
              }
            }
          }
        ]
      },
      include: {
        members: {
          where: {
            userId: { in: validConnectionUserIds },
            isBanned: false
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true
              }
            }
          }
        },
        _count: {
          select: {
            members: {
              where: {
                isBanned: false
              }
            }
          }
        }
      }
    });

    // Format the response
    const result = groupsWithMembers.map(group => ({
      id: group.id,
      name: group.name,
      description: group.description,
      groupType: group.groupType,
      createdAt: group.createdAt,
      adminId: group.adminId,
      memberCount: group._count.members,
      mutualConnections: group.members.map(member => ({
        membershipId: member.membershipId,
        userId: member.userId,
        joinedAt: member.joinedAt,
        user: member.user
      }))
    }));

    // Sort by member count (ascending - least to most)
    result.sort((a, b) => a.memberCount - b.memberCount);

    return res.json(result);
  } catch (error) {
    console.error("Error fetching mutual groups:", error);
    return res.status(500).send("Internal server error");
  }
});

// --- Get Group Details ---
router.get("/groups/:groupId", auth, async (req, res) => {
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
    // Get group information with admin details
    const group = await prisma.groups.findUnique({
      where: { id: groupId },
      include: {
        admin: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true
          }
        },
        _count: {
          select: {
            members: {
              where: {
                isBanned: false
              }
            }
          }
        }
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
    const requesterMembership = await prisma.groupMember.findUnique({
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

    // Get members list (all for members, limited for non-members if membership is hidden)
    let members = [];
    let memberVisibility = "VISIBLE";

    if (requesterMembership || !group.membershipHidden) {
      // Get all non-banned members
      const membersList = await prisma.groupMember.findMany({
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
              lastName: true
            }
          }
        },
        orderBy: {
          joinedAt: 'asc'
        }
      });

      members = membersList.map(member => ({
        membershipId: member.membershipId,
        userId: member.userId,
        joinedAt: member.joinedAt,
        user: member.user
      }));
    } else {
      memberVisibility = "HIDDEN";
    }

    // Apply display label logic
    let displayLabel = "Social Circle";
    if (group.groupType === "PUBLIC") {
      displayLabel = `${group.name} public assembly room`;
    } else if (group.groupType === "PRIVATE") {
      displayLabel = `${group.name} private assembly room`;
    }

    // Return group details with members
    return res.status(200).json({
      id: group.id,
      name: group.name,
      description: group.description,
      groupType: group.groupType,
      isHidden: group.isHidden,
      membershipHidden: group.membershipHidden,
      adminId: group.adminId,
      admin: group.admin,
      createdAt: group.createdAt,
      displayLabel: displayLabel,
      memberCount: group._count.members,
      members: members,
      memberVisibility: memberVisibility,
      isMember: !!requesterMembership,
      isAdmin: group.adminId === userId
    });

  } catch (error) {
    console.error("Error fetching group details:", error);
    res.status(500).send("Internal server error");
  }
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
        membershipHidden: true,
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
    const requesterMembership = await prisma.groupMember.findUnique({
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

    // Check if membership is hidden for non-members
    if (!requesterMembership && group.membershipHidden) {
      const totalCount = await prisma.groupMember.count({
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

    // Get all non-banned members
    const members = await prisma.groupMember.findMany({
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
            lastName: true
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
    const existingMembership = await prisma.groupMember.findUnique({
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
    const member = await prisma.groupMember.findUnique({
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

// --- Get Pending Join Requests for Group ---
router.get("/groups/:groupId/join-requests/pending", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const userId = me.id;
  const groupId = req.params.groupId;

  if (!groupId || groupId.trim() === '') {
    return res.status(400).send("Group ID is required");
  }

  try {
    // Check if the group exists and get the admin ID
    const group = await prisma.groups.findUnique({
      where: {
        id: groupId
      },
      select: {
        id: true,
        adminId: true
      }
    });

    if (!group) {
      return res.status(404).send("Group not found");
    }

    // Check if user is the group admin
    const isAdmin = group.adminId === userId;

    if (!isAdmin) {
      // If not admin, check if user is a member of the group
      const groupMember = await prisma.groupMember.findUnique({
        where: {
          userId_groupId: {
            userId: userId,
            groupId: groupId
          }
        }
      });

      // If not a member, return 404
      if (!groupMember) {
        return res.status(404).send("Not found");
      }

      // If member is banned, return 403
      if (groupMember.isBanned) {
        return res.status(403).send("Forbidden");
      }

      // Check if user is a moderator in the RoundTable
      const roundTableMember = await prisma.roundTableMember.findFirst({
        where: {
          userId: userId,
          groupId: groupId
        }
      });

      // If not in RoundTable or not a moderator, return 403
      if (!roundTableMember || !roundTableMember.isModerator) {
        return res.status(403).send("Forbidden");
      }
    }

    // Get pending join requests for the group
    const pendingRequests = await prisma.joinGroup.findMany({
      where: {
        groupId: groupId,
        status: "PENDING"
      },
      include: {
        requester: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return res.json(pendingRequests);
  } catch (error) {
    console.error("Error fetching pending join requests:", error);
    return res.status(500).send("Internal server error");
  }
});

// --- Accept join group request ---
router.post("/groups/requests/:requestId/accept", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const userId = me.id;
  const { requestId } = req.params;

  if (!requestId) {
    return res.status(400).send("Missing request ID");
  }

  try {
    // Find the join request
    const joinRequest = await prisma.joinGroup.findUnique({
      where: { id: requestId },
      include: {
        group: true,
        requester: true
      }
    });

    if (!joinRequest) {
      return res.status(404).send("Join request not found");
    }

    const groupId = joinRequest.groupId;

    // Check if the user is the group admin (admins can always accept join requests)
    const isGroupAdmin = joinRequest.group.adminId === userId;

    // Check if the requester (who is trying to accept) is in the GroupMember table
    const groupMember = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: {
          userId: userId,
          groupId: groupId
        }
      }
    });

    // If user is not group admin and not a group member, deny access
    if (!isGroupAdmin && !groupMember) {
      return res.status(404).send("Not found");
    }

    // Check if the group member (not admin) is banned from the group
    if (groupMember && groupMember.isBanned) {
      return res.status(403).send("Forbidden");
    }

    // If user is not the group admin, check RoundTableMember status
    if (!isGroupAdmin) {
      const roundTableMember = await prisma.roundTableMember.findUnique({
        where: {
          groupId_userId: {
            groupId: groupId,
            userId: userId
          }
        }
      });

      if (roundTableMember) {
        // If user is in RoundTableMember, check moderator and expulsion status
        if (!roundTableMember.isModerator) {
          return res.status(403).send("Forbidden");
        }
        
        // Check if expelled
        if (roundTableMember.isExpelled) {
          return res.status(403).send("Forbidden");
        }
      }
    }

    // Update the join request status to ACCEPTED
    const updatedRequest = await prisma.joinGroup.update({
      where: { id: requestId },
      data: {
        status: "ACCEPTED",
        decidedAt: new Date(),
        decidedById: userId
      },
      include: {
        group: true,
        requester: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    // Add the original requester to the GroupMember table
    await prisma.groupMember.create({
      data: {
        userId: joinRequest.requesterId,
        groupId: groupId,
        joinedAt: new Date()
      }
    });

    res.status(200).json(updatedRequest);
  } catch (error) {
    console.error("Error accepting join request:", error);
    res.status(500).send("Internal server error");
  }
});

// --- Get User's Groups ---
router.get("/users/:userId/groups", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const requesterId = me.id;
  const targetUserId = req.params.userId;

  if (!targetUserId) {
    return res.status(400).send("Missing user ID");
  }

  try {
    // Get requester's connections
    const connections = await prisma.connections.findMany({
      where: {
        OR: [
          { requesterId: requesterId },
          { requestedId: requesterId }
        ]
      },
      include: {
        requester: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            isHidden: true,
            isBanned: true
          }
        },
        requested: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            isHidden: true,
            isBanned: true
          }
        }
      }
    });

    // Extract connection user IDs (excluding current user)
    const connectionUserIds = connections
      .map(conn => conn.requesterId === requesterId ? conn.requestedId : conn.requesterId)
      .filter(id => id !== requesterId);

    // Get blocks to filter out blocked users
    const blocks = await prisma.blocks.findMany({
      where: {
        OR: [
          { blockerId: requesterId },
          { blockedId: requesterId }
        ]
      }
    });

    const blockedUserIds = new Set(
      blocks.map(block => 
        block.blockerId === requesterId ? block.blockedId : block.blockerId
      )
    );

    // Filter connections to exclude hidden, banned, or blocked users
    const validConnectionUserIds = connectionUserIds.filter(connId => {
      if (blockedUserIds.has(connId)) return false;
      
      const connection = connections.find(conn => 
        (conn.requesterId === requesterId && conn.requestedId === connId) ||
        (conn.requestedId === requesterId && conn.requesterId === connId)
      );
      
      if (!connection) return false;
      
      const connectedUser = connection.requesterId === requesterId ? connection.requested : connection.requester;
      
      // Exclude hidden or banned users
      if (connectedUser.isHidden || connectedUser.isBanned) return false;
      
      return true;
    });

    // Get all groups where the target user is a member (not banned)
    const memberships = await prisma.groupMember.findMany({
      where: {
        userId: targetUserId,
        isBanned: false
      },
      include: {
        group: {
          include: {
            admin: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true
              }
            }
          }
        }
      },
      orderBy: {
        joinedAt: 'desc'
      }
    });

    // Get all groups where the target user is the admin
    const adminGroups = await prisma.groups.findMany({
      where: {
        adminId: targetUserId
      },
      include: {
        admin: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Get groups where requester's mutual connections are admins
    const mutualAdminGroups = validConnectionUserIds.length > 0 
      ? await prisma.groups.findMany({
          where: {
            adminId: { in: validConnectionUserIds },
            isHidden: false,
            groupType: { notIn: ["PERSONAL"] }
          },
          include: {
            admin: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        })
      : [];

    // Filter groups based on visibility rules
    const visibleGroups = memberships.filter((membership: any) => {
      const group = membership.group;

      // Filter out PERSONAL groups if requester is not the owner
      if (group.groupType === "PERSONAL" && group.adminId !== requesterId) {
        return false;
      }

      // Filter out hidden groups unless requester is admin or member
      if (group.isHidden) {
        const isAdmin = group.adminId === requesterId;
        // Check if requester is a member of this group
        const isMember = memberships.some((m: any) => m.groupId === group.id && m.userId === requesterId);
        
        if (!isAdmin && !isMember) {
          return false;
        }
      }

      return true;
    });

    // Filter admin groups based on visibility rules
    const visibleAdminGroups = adminGroups.filter((group: any) => {
      // Filter out PERSONAL groups if requester is not the owner
      if (group.groupType === "PERSONAL" && group.adminId !== requesterId) {
        return false;
      }

      // Filter out hidden groups unless requester is admin or member
      if (group.isHidden) {
        const isAdmin = group.adminId === requesterId;
        // Check if requester is a member of this group
        const isMember = memberships.some((m: any) => m.groupId === group.id && m.userId === requesterId);
        
        if (!isAdmin && !isMember) {
          return false;
        }
      }

      return true;
    });

    // Format the response for membership groups
    const memberGroups = visibleGroups.map((membership: any) => {
      const group = membership.group;
      
      let displayLabel = "Social Circle";
      if (group.groupType === "PUBLIC") {
        displayLabel = `${group.name} public assembly room`;
      } else if (group.groupType === "PRIVATE") {
        displayLabel = `${group.name} private assembly room`;
      }

      return {
        id: group.id,
        name: group.name,
        description: group.description,
        groupType: group.groupType,
        isHidden: group.isHidden,
        adminId: group.adminId,
        admin: group.admin,
        displayLabel: displayLabel,
        joinedAt: membership.joinedAt
      };
    });

    // Format the response for admin groups
    const formattedAdminGroups = visibleAdminGroups.map((group: any) => {
      let displayLabel = "Social Circle";
      if (group.groupType === "PUBLIC") {
        displayLabel = `${group.name} public assembly room`;
      } else if (group.groupType === "PRIVATE") {
        displayLabel = `${group.name} private assembly room`;
      }

      return {
        id: group.id,
        name: group.name,
        description: group.description,
        groupType: group.groupType,
        isHidden: group.isHidden,
        adminId: group.adminId,
        admin: group.admin,
        displayLabel: displayLabel,
        joinedAt: group.createdAt // Use createdAt for admin groups since they don't have a membership joinedAt
      };
    });

    // Format the response for mutual admin groups
    const formattedMutualAdminGroups = mutualAdminGroups.map((group: any) => {
      let displayLabel = "Social Circle";
      if (group.groupType === "PUBLIC") {
        displayLabel = `${group.name} public assembly room`;
      } else if (group.groupType === "PRIVATE") {
        displayLabel = `${group.name} private assembly room`;
      }

      return {
        id: group.id,
        name: group.name,
        description: group.description,
        groupType: group.groupType,
        isHidden: group.isHidden,
        adminId: group.adminId,
        admin: group.admin,
        displayLabel: displayLabel,
        joinedAt: group.createdAt
      };
    });

    // Combine all lists and remove duplicates (in case user is both admin and member)
    const allGroupsMap = new Map();
    
    [...memberGroups, ...formattedAdminGroups, ...formattedMutualAdminGroups].forEach((group: any) => {
      if (!allGroupsMap.has(group.id)) {
        allGroupsMap.set(group.id, group);
      }
    });

    const groups = Array.from(allGroupsMap.values()).sort((a: any, b: any) => {
      return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
    });

    return res.json({ groups });
  } catch (error) {
    console.error("Error in GET /users/:userId/groups:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
