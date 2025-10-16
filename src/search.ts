import { Router } from "express";
import { PrismaClient, Prisma } from "./generated/prisma/index.js";
import { auth } from "./misc.js";

const prisma = new PrismaClient();
const router = Router();

// GET /search/users - Search for users with enhanced full-name support
router.get("/search/users", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = (req.user as any).id;
  const { q, limit = "10", offset = "0" } = req.query;

  // Validate query parameter
  const query = String(q || "").trim();
  if (!query) {
    return res.status(400).send("Query parameter 'q' is required");
  }

  // Parse pagination parameters
  const limitNum = Math.max(1, Math.min(50, parseInt(String(limit))));
  const offsetNum = Math.max(0, parseInt(String(offset)));

  try {
    // Get blocked users to exclude from results
    const blockedUsers = await prisma.blocks.findMany({
      where: {
        OR: [
          { blockerId: me },
          { blockedId: me }
        ]
      },
      select: { blockerId: true, blockedId: true }
    });

    const blockedUserIds = new Set<string>();
    blockedUsers.forEach(block => {
      blockedUserIds.add(block.blockerId);
      blockedUserIds.add(block.blockedId);
    });

    // Split query into tokens for full-name search
    const tokens = query.split(/\s+/).filter(token => token.length > 0);
    
    // Debug: check what users exist
    const allUsers = await prisma.$queryRaw`
      SELECT id, username, firstName, lastName 
      FROM Users 
      WHERE id != ${me}
      LIMIT 10
    `;
    console.log('All users in DB:', allUsers);
    
    let users: any[];

    if (tokens.length >= 2) {
      // Multi-token search: support full name queries
      const token1 = tokens[0];
      const token2 = tokens[1];
      
      const blockedUsersArray = Array.from(blockedUserIds);
      
      if (blockedUsersArray.length > 0) {
        users = await prisma.$queryRaw`
          SELECT id, username, firstName, lastName, photo 
          FROM Users 
          WHERE id != ${me}
            AND isBanned = 0 
            AND id NOT IN (${Prisma.join(blockedUsersArray)})
            AND (
              LOWER(username) LIKE LOWER(${`%${query}%`}) OR
              LOWER(firstName) LIKE LOWER(${`%${query}%`}) OR
              LOWER(lastName) LIKE LOWER(${`%${query}%`}) OR
              (LOWER(firstName) LIKE LOWER(${`%${token1}%`}) AND LOWER(lastName) LIKE LOWER(${`%${token2}%`})) OR
              (LOWER(firstName) LIKE LOWER(${`%${token2}%`}) AND LOWER(lastName) LIKE LOWER(${`%${token1}%`}))
            )
          ORDER BY firstName ASC, lastName ASC, username ASC
          LIMIT ${limitNum} OFFSET ${offsetNum}
        `;
      } else {
        users = await prisma.$queryRaw`
          SELECT id, username, firstName, lastName, photo 
          FROM Users 
          WHERE id != ${me}
            AND isBanned = 0 
            AND (
              LOWER(username) LIKE LOWER(${`%${query}%`}) OR
              LOWER(firstName) LIKE LOWER(${`%${query}%`}) OR
              LOWER(lastName) LIKE LOWER(${`%${query}%`}) OR
              (LOWER(firstName) LIKE LOWER(${`%${token1}%`}) AND LOWER(lastName) LIKE LOWER(${`%${token2}%`})) OR
              (LOWER(firstName) LIKE LOWER(${`%${token2}%`}) AND LOWER(lastName) LIKE LOWER(${`%${token1}%`}))
            )
          ORDER BY firstName ASC, lastName ASC, username ASC
          LIMIT ${limitNum} OFFSET ${offsetNum}
        `;
      }
    } else {
      // Single token search
      const token = tokens[0] || query;
      
      const blockedUsersArray = Array.from(blockedUserIds);
      
      if (blockedUsersArray.length > 0) {
        users = await prisma.$queryRaw`
          SELECT id, username, firstName, lastName, photo 
          FROM Users 
          WHERE id != ${me}
            AND isBanned = 0 
            AND id NOT IN (${Prisma.join(blockedUsersArray)})
            AND (
              LOWER(username) LIKE LOWER(${`%${token}%`}) OR
              LOWER(firstName) LIKE LOWER(${`%${token}%`}) OR
              LOWER(lastName) LIKE LOWER(${`%${token}%`})
            )
          ORDER BY firstName ASC, lastName ASC, username ASC
          LIMIT ${limitNum} OFFSET ${offsetNum}
        `;
      } else {
        users = await prisma.$queryRaw`
          SELECT id, username, firstName, lastName, photo 
          FROM Users 
          WHERE id != ${me}
            AND isBanned = 0 
            AND (
              LOWER(username) LIKE LOWER(${`%${token}%`}) OR
              LOWER(firstName) LIKE LOWER(${`%${token}%`}) OR
              LOWER(lastName) LIKE LOWER(${`%${token}%`})
            )
          ORDER BY firstName ASC, lastName ASC, username ASC
          LIMIT ${limitNum} OFFSET ${offsetNum}
        `;
      }
    }

    res.json(users);

    // Debug logging (remove in production)
    console.log('Search query:', query);
    console.log('Tokens:', tokens);
    console.log('Found users:', users);
  } catch (e) {
    console.error("Error searching users:", e);
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
