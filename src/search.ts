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

    const users = await prisma.users.findMany({
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
    const allGroups = await prisma.groups.findMany({
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

    // Filter groups based on visibility rules
    const filteredGroups = allGroups.filter(g => {
      // Exclude PERSONAL groups unless the requester is the admin
      if (g.groupType === "PERSONAL" && g.adminId !== userId) {
        return false;
      }

      // Exclude hidden groups unless requester is admin or member
      if (g.isHidden) {
        const isAdmin = g.adminId === userId;
        const isMember = g.members.length > 0;
        
        if (!isAdmin && !isMember) {
          return false;
        }
      }

      return true;
    });

    // Remove members array and adminId from response, keep only required fields
    const groups = filteredGroups.map(g => ({
      id: g.id,
      name: g.name,
      groupType: g.groupType,
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

export default router;
