import { Router } from "express";
import { auth } from "./misc.js";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();

// --- View a user's profile (with privacy and relationship-based visibility) ---
router.get("/users/:id", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = (req.user as any).id;
  const targetUserId = req.params.id;

  if (!targetUserId) {
    return res.status(400).send("Missing user ID");
  }

  try {
    // Get the target user with basic info
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        profilePhoto: true,
        about: true,
        gender: true,
        isPrivate: true,
        isHidden: true,
        isBanned: true,
      },
    });

    if (!targetUser) {
      return res.status(404).send("User not found");
    }

    // Check if user is banned or hidden
    if (targetUser.isBanned || targetUser.isHidden) {
      return res.status(404).send("User not found");
    }

    // Check if the session user has blocked the target user or vice versa
    const blockExists = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: sessionUserId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: sessionUserId },
        ],
      },
    });

    if (blockExists) {
      return res.status(404).send("User not found");
    }

    // Check if users are connected using adjacency table
    const connection = await prisma.userConnection.findFirst({
      where: {
        userId: sessionUserId,
        otherUserId: targetUserId,
        type: { in: ["ACQUAINTANCE", "STRANGER", "IS_FOLLOWING"] }
      },
    });

    const isConnected = !!connection;
    const connectionStatus = connection?.type || null;

    // Check for pending connection request from session user to target user
    const pendingConnectionRequest = await prisma.connectionRequest.findFirst({
      where: {
        requesterId: sessionUserId,
        requestedId: targetUserId,
        status: "PENDING"
      }
    });

    const pendingRequest = !!pendingConnectionRequest;
    const requestType = pendingRequest ? pendingConnectionRequest.type : null;

    // Get follower and following counts
    const [followerCount, followingCount] = await Promise.all([
      // Count users who follow the target user
      prisma.userConnection.count({
        where: {
          otherUserId: targetUserId,
          type: "IS_FOLLOWING"
        }
      }),
      // Count users the target user follows
      prisma.userConnection.count({
        where: {
          userId: targetUserId,
          type: "IS_FOLLOWING"
        }
      })
    ]);

    // Check if target user follows session user (reverse follow)
    const isFollowingYou = await prisma.userConnection.findFirst({
      where: {
        userId: targetUserId,
        otherUserId: sessionUserId,
        type: "IS_FOLLOWING"
      }
    });

    // Build response based on privacy and connection status
    if (isConnected || !targetUser.isPrivate) {
      // Connected or target is not private - show extended profile with posts
      const posts = await prisma.post.findMany({
        where: {
          userId: targetUserId,
          visibility: { in: ["PUBLIC", "GROUP"] }
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          content: true,
          media: true,
          orientation: true,
          createdAt: true,
          visibility: true,
          groupId: true,
          userId: true,
        }
      });

      console.log("📸 Returning profile with photo:", targetUser.profilePhoto);
      return res.status(200).json({
        id: targetUser.id,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        username: targetUser.username,
        gender: targetUser.gender,
        profilePhoto: targetUser.profilePhoto,
        about: targetUser.about,
        isPrivate: targetUser.isPrivate,
        connectionStatus: connectionStatus,
        requestType: requestType,
        followerCount: followerCount,
        followingCount: followingCount,
        isFollowingYou: !!isFollowingYou,
        posts: posts,
      });
    } else {
      // Target is private and not connected - show minimal profile
      console.log("📸 Returning minimal profile with photo:", targetUser.profilePhoto);
      return res.status(200).json({
        id: targetUser.id,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        username: targetUser.username,
        gender: targetUser.gender,
        profilePhoto: targetUser.profilePhoto,
        about: targetUser.about,
        isPrivate: targetUser.isPrivate,
        connectionStatus: connectionStatus,
        requestType: requestType,
        followerCount: followerCount,
        followingCount: followingCount,
        isFollowingYou: !!isFollowingYou,
      });
    }

  } catch (e) {
    console.error("Error fetching user profile:", e);
    if (e instanceof Error) {
      return res.status(400).json({ error: e.message });
    } else {
      return res.status(400).json({ error: String(e) });
    }
  }
});

// --- Get a user's followers ---
router.get("/users/:id/followers", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = (req.user as any).id;
  const targetUserId = req.params.id;

  if (!targetUserId) {
    return res.status(400).send("Missing user ID");
  }

  try {
    // Check if target user exists and is not banned/hidden
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, isBanned: true, isHidden: true }
    });

    if (!targetUser || targetUser.isBanned || targetUser.isHidden) {
      return res.status(404).send("User not found");
    }

    // Get followers using adjacency table (fast!)
    // Find all users where otherUserId = targetUserId and type = IS_FOLLOWING
    const followers = await prisma.userConnection.findMany({
      where: {
        otherUserId: targetUserId,
        type: "IS_FOLLOWING"
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            profilePhoto: true,
            isHidden: true,
            isBanned: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    // Filter out banned/hidden users and check if session user has blocked them
    const blocks = await prisma.block.findMany({
      where: {
        OR: [
          { blockerId: sessionUserId },
          { blockedId: sessionUserId }
        ]
      }
    });

    const blockedUserIds = new Set(
      blocks.map((block: any) => 
        block.blockerId === sessionUserId ? block.blockedId : block.blockerId
      )
    );

    const validFollowers = followers
      .filter((f: any) => !f.user.isBanned && !f.user.isHidden && !blockedUserIds.has(f.user.id))
      .map((f: any) => ({
        id: f.user.id,
        firstName: f.user.firstName,
        lastName: f.user.lastName,
        username: f.user.username,
        profilePhoto: f.user.profilePhoto,
        followedAt: f.createdAt
      }));

    return res.status(200).json(validFollowers);
  } catch (e) {
    console.error("Error fetching followers:", e);
    if (e instanceof Error) {
      return res.status(400).json({ error: e.message });
    } else {
      return res.status(400).json({ error: String(e) });
    }
  }
});

// --- Get who a user is following ---
router.get("/users/:id/following", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const sessionUserId = (req.user as any).id;
  const targetUserId = req.params.id;

  if (!targetUserId) {
    return res.status(400).send("Missing user ID");
  }

  try {
    // Check if target user exists and is not banned/hidden
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, isBanned: true, isHidden: true }
    });

    if (!targetUser || targetUser.isBanned || targetUser.isHidden) {
      return res.status(404).send("User not found");
    }

    // Get following using adjacency table (fast!)
    // Find all users where userId = targetUserId and type = IS_FOLLOWING
    const following = await prisma.userConnection.findMany({
      where: {
        userId: targetUserId,
        type: "IS_FOLLOWING"
      },
      select: {
        otherUserId: true,
        createdAt: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    // Get user details for those being followed
    const followedUserIds = following.map((f: any) => f.otherUserId);
    
    if (followedUserIds.length === 0) {
      return res.status(200).json([]);
    }

    const users = await prisma.user.findMany({
      where: {
        id: { in: followedUserIds }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        profilePhoto: true,
        isHidden: true,
        isBanned: true
      }
    });

    // Filter out banned/hidden users and check if session user has blocked them
    const blocks = await prisma.block.findMany({
      where: {
        OR: [
          { blockerId: sessionUserId },
          { blockedId: sessionUserId }
        ]
      }
    });

    const blockedUserIds = new Set(
      blocks.map((block: any) => 
        block.blockerId === sessionUserId ? block.blockedId : block.blockerId
      )
    );

    // Create a map for quick lookup of follow dates
    const followDateMap = new Map(
      following.map((f: any) => [f.otherUserId, f.createdAt])
    );

    const validFollowing = users
      .filter((u: any) => !u.isBanned && !u.isHidden && !blockedUserIds.has(u.id))
      .map((u: any) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
        profilePhoto: u.profilePhoto,
        followedAt: followDateMap.get(u.id)
      }))
      .sort((a: any, b: any) => {
        const dateA = a.followedAt ? new Date(a.followedAt).getTime() : 0;
        const dateB = b.followedAt ? new Date(b.followedAt).getTime() : 0;
        return dateB - dateA; // Descending order (newest first)
      });

    return res.status(200).json(validFollowing);
  } catch (e) {
    console.error("Error fetching following:", e);
    if (e instanceof Error) {
      return res.status(400).json({ error: e.message });
    } else {
      return res.status(400).json({ error: String(e) });
    }
  }
});

export default router;
