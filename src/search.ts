import { Router } from "express";
import { auth } from "./misc.js";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();

// --- Search Users and Groups ---
router.get("/search/users", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const userId = me.id;

  const q = req.query.q as string;
  
  // If query is missing or blank, return empty results
  if (!q || typeof q !== "string" || q.trim().length === 0) {
    return res.json({ users: [], groups: [] });
  }

  const query = q.trim();

  try {
    // Search Users
    let userWhere: any = {
      isBanned: false,
      isHidden: false, // Exclude hidden users from search
    };

    // Check if query has 2+ tokens for full name search
    const tokens = query.split(/\s+/).filter(token => token.length > 0);
    
    if (tokens.length >= 2) {
      // Full name search: (firstName contains token1 AND lastName contains token2) OR the swap
      const [token1, token2] = tokens;
      userWhere.OR = [
        {
          username: {
            contains: query
          }
        },
        {
          AND: [
            { firstName: { contains: token1 } },
            { lastName: { contains: token2 } }
          ]
        },
        {
          AND: [
            { firstName: { contains: token2 } },
            { lastName: { contains: token1 } }
          ]
        }
      ];
    } else {
      // Single token search: just username
      userWhere.username = {
        contains: query
      };
    }

    const users = await prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        profilePhoto: true,
      }
    });

    // Search Groups
    const allGroups = await prisma.group.findMany({
      where: {
        name: {
          contains: query
        }
      },
      include: {
        members: {
          where: { userId: userId },
          select: { userId: true }
        }
      }
    });

    // Get all user's acquaintance connections for PERSONAL group filtering
    const acquaintanceIds = await prisma.userConnection.findMany({
      where: {
        userId: userId,
        type: "ACQUAINTANCE"
      },
      select: {
        otherUserId: true
      }
    });
    const acquaintanceUserIds = new Set(acquaintanceIds.map(a => a.otherUserId));

    // Filter groups based on visibility rules
    const filteredGroups = allGroups.filter(g => {
      const isAdmin = g.adminId === userId;
      const isMember = g.members.length > 0;
      
      // For PERSONAL groups: only admin and acquaintances can see them (unless hidden)
      if (g.groupPrivacy === "PERSONAL" && !isAdmin && !acquaintanceUserIds.has(g.adminId)) {
        return false;
      }

      // For all groups: if hidden, only admin or members can see them
      if (g.isHidden && !isAdmin && !isMember) {
        return false;
      }

      return true;
    });

    // Remove members array and adminId from response, keep only required fields
    const groups = filteredGroups.map(g => ({
      id: g.id,
      name: g.name,
      groupType: g.groupType,
      groupPrivacy: g.groupPrivacy,
      isHidden: g.isHidden,
    }));

    return res.json({ users, groups });
  } catch (e) {
    if (e instanceof Error) {
      return res.status(400).json({ error: e.message });
    } else {
      return res.status(400).json({ error: String(e) });
    }
  }
});

// --- Search Posts with Audience-Based Authorization ---
router.get("/search/posts", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const userId = (req.user as any).id;
  const q = req.query.q as string;

  // If query is missing or blank, return empty results
  if (!q || typeof q !== "string" || q.trim().length === 0) {
    return res.json({ posts: [] });
  }

  const query = q.trim();

  try {
    // Get user's connections for filtering
    const connections = await prisma.userConnection.findMany({
      where: { userId: userId },
      select: { otherUserId: true, type: true }
    });
    const connectionUserIds = connections.map((c: any) => c.otherUserId);
    const acquaintanceUserIds = connections
      .filter((c: any) => c.type === "ACQUAINTANCE")
      .map((c: any) => c.otherUserId);

    // Get user's subnet memberships
    const subnetMemberships = await prisma.subNetMember.findMany({
      where: { userId: userId },
      select: { subNetId: true }
    });
    const subnetIds = subnetMemberships.map((m: any) => m.subNetId);

    // Get subnets owned by user
    const ownedSubnets = await prisma.subNet.findMany({
      where: { ownerId: userId },
      select: { id: true }
    });
    const ownedSubnetIds = ownedSubnets.map((s: any) => s.id);
    const allSubnetIds = [...new Set([...subnetIds, ...ownedSubnetIds])];

    // Search posts with content matching query, applying audience filters
    const posts = await prisma.post.findMany({
      where: {
        content: {
          contains: query
        },
        OR: [
          // User's own posts
          { userId: userId },
          // PUBLIC posts
          { visibility: "PUBLIC" },
          // CONNECTIONS posts from connected users
          {
            visibility: "CONNECTIONS",
            userId: { in: connectionUserIds }
          },
          // ACQUAINTANCES posts from acquaintances
          {
            visibility: "ACQUAINTANCES",
            userId: { in: acquaintanceUserIds }
          },
          // SUBNET posts from subnets user is in or owns
          {
            visibility: "SUBNET",
            subNetId: { in: allSubnetIds }
          }
        ]
      },
      select: {
        postId: true,
        content: true,
        media: true,
        orientation: true,
        createdAt: true,
        visibility: true,
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePhoto: true
          }
        },
        subNet: {
          select: {
            id: true,
            name: true
          }
        },
        group: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 50 // Limit results
    });

    return res.json({ posts });
  } catch (e) {
    if (e instanceof Error) {
      return res.status(400).json({ error: e.message });
    } else {
      return res.status(400).json({ error: String(e) });
    }
  }
});

export default router;
