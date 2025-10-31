
import { Router } from "express";
import { GroupPrivacy, PostVisibility } from "./generated/prisma/index.js";
import { auth } from "./misc.js";
import { prismaClient as prisma } from "./prismaClient.js";
const router = Router();

// --- Helper: Check if user can view a post ---
async function canUserViewPost(userId: string, post: any): Promise<boolean> {
  // User can always see their own posts
  if (post.userId === userId) {
    return true;
  }

  // PUBLIC posts are visible to everyone
  if (post.visibility === "PUBLIC") {
    return true;
  }

  // CONNECTIONS posts - user must be connected (acquaintance, stranger, or following)
  if (post.visibility === "CONNECTIONS") {
    const connection = await prisma.userConnection.findFirst({
      where: {
        userId: userId,
        otherUserId: post.userId,
        type: { in: ["ACQUAINTANCE", "STRANGER", "IS_FOLLOWING"] }
      }
    });
    return !!connection;
  }

  // ACQUAINTANCES posts - user must be an acquaintance
  if (post.visibility === "ACQUAINTANCES") {
    const connection = await prisma.userConnection.findFirst({
      where: {
        userId: userId,
        otherUserId: post.userId,
        type: "ACQUAINTANCE"
      }
    });
    return !!connection;
  }

  // STRANGERS posts - user must be a stranger
  if (post.visibility === "STRANGERS") {
    const connection = await prisma.userConnection.findFirst({
      where: {
        userId: userId,
        otherUserId: post.userId,
        type: "STRANGER"
      }
    });
    return !!connection;
  }

  // SUBNET posts - user must be a member of the subnet or the subnet owner
  if (post.visibility === "SUBNET" && post.subNetId) {
    const subnet = await prisma.subNet.findUnique({
      where: { id: post.subNetId },
      select: { ownerId: true }
    });
    
    if (subnet && subnet.ownerId === userId) {
      return true;
    }

    const member = await prisma.subNetMember.findUnique({
      where: { subNetId_userId: { subNetId: post.subNetId, userId: userId } }
    });
    return !!member;
  }

  return false;
}


// --- Create Post (≤500 chars) with audience-based visibility ---
router.post("/posts", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const { content, media, visibility, subnetId, imageWidth, imageHeight } = req.body ?? {};

  // Validate that at least one of content or media is provided
  const text = content ? String(content).trim() : null;
  const mediaKey = media ? String(media).trim() : null;

  if (!text && !mediaKey) {
    return res.status(400).json({ 
      error: "INVALID_POST_CONTENT", 
      message: "Post must include text or media." 
    });
  }

  // Validate content length if provided
  if (text && text.length > 500) {
    return res.status(400).send("Content must be 500 characters or less");
  }

  // Calculate orientation if image dimensions are provided
  let orientation: "LANDSCAPE" | "PORTRAIT" | null = null;
  if (mediaKey && imageWidth && imageHeight) {
    const width = Number(imageWidth);
    const height = Number(imageHeight);
    orientation = height > width ? "PORTRAIT" : "LANDSCAPE";
  }

  // Block banned users from posting
  const meRow = await prisma.user.findUnique({ where: { id: me.id }, select: { isBanned: true } });
  if (!meRow) return res.status(404).send("User not found");
  if (meRow.isBanned) return res.status(403).send("account banned");

  // Validate visibility
  const validVisibilities = ["PUBLIC", "CONNECTIONS", "ACQUAINTANCES", "STRANGERS", "SUBNET"];
  const postVisibility = visibility ? String(visibility).toUpperCase() : "PUBLIC";
  
  if (!validVisibilities.includes(postVisibility)) {
    return res.status(400).send("Invalid visibility. Must be PUBLIC, CONNECTIONS, ACQUAINTANCES, STRANGERS, or SUBNET");
  }

  try {
    // Prepare post data
    const postData: any = {
      userId: me.id,
      content: text || null,
      media: mediaKey || null,
      orientation: orientation,
      visibility: postVisibility,
    };

    // Handle SUBNET visibility
    if (postVisibility === "SUBNET") {
      if (!subnetId) {
        return res.status(400).send("subnetId required for SUBNET visibility");
      }

      const subnet = await prisma.subNet.findUnique({
        where: { id: String(subnetId) },
        select: { id: true, ownerId: true },
      });
      if (!subnet) return res.status(404).send("Subnet not found");

      // Check if user is the owner
      if (subnet.ownerId === me.id) {
        // Owner can post
        postData.subNetId = subnet.id;
      } else {
        // Check if user is a member with posting permissions
        const member = await prisma.subNetMember.findUnique({
          where: { subNetId_userId: { subNetId: subnet.id, userId: me.id } },
          select: { role: true },
        });

        if (!member) {
          return res.status(403).send("Not a member of this subnet");
        }

        // Only OWNER, MANAGER, and CONTRIBUTOR can post to subnets
        if (!["OWNER", "MANAGER", "CONTRIBUTOR"].includes(member.role)) {
          return res.status(403).send("Insufficient permissions to post to this subnet. Must be OWNER, MANAGER, or CONTRIBUTOR");
        }

        postData.subNetId = subnet.id;
      }
    }

    // Validate CONNECTIONS, ACQUAINTANCES, and STRANGERS visibility
    if (postVisibility === "CONNECTIONS" || postVisibility === "ACQUAINTANCES" || postVisibility === "STRANGERS") {
      // No additional validation needed - these are network-wide visibility settings
      // The feed filter will handle who can see these posts
    }

    const post = await prisma.post.create({
      data: postData,
      select: { 
        id: true, 
        content: true, 
        media: true, 
        orientation: true,
        createdAt: true, 
        userId: true, 
        subNetId: true,
        visibility: true 
      },
    });
    return res.status(201).json(post);
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});


// GET /feed  -> posts visible to the user based on audience filters
router.get("/feed", auth, async (req, res) => {
  const me = (req as any).user.id as string;

  // Get user's connections
  const userConnections = await prisma.userConnection.findMany({
    where: {
      userId: me,
      type: { in: ["ACQUAINTANCE", "STRANGER", "IS_FOLLOWING"] }
    },
    select: { otherUserId: true, type: true }
  });

  const acquaintances = new Set<string>();
  const strangers = new Set<string>();
  const followingIds = new Set<string>();
  
  for (const conn of userConnections) {
    if (conn.type === "ACQUAINTANCE") {
      acquaintances.add(conn.otherUserId);
    } else if (conn.type === "STRANGER") {
      strangers.add(conn.otherUserId);
    } else if (conn.type === "IS_FOLLOWING") {
      followingIds.add(conn.otherUserId);
    }
  }

  const connectedUserIds = Array.from(new Set([...acquaintances, ...strangers, ...followingIds]));

  // Get user's subnet memberships
  const subnetMemberships = await prisma.subNetMember.findMany({
    where: { userId: me },
    select: { subNetId: true }
  });
  const subnetIds = subnetMemberships.map((m: any) => m.subNetId);

  // Get user's owned subnets
  const ownedSubnets = await prisma.subNet.findMany({
    where: { ownerId: me },
    select: { id: true }
  });
  const ownedSubnetIds = ownedSubnets.map((s: any) => s.id);
  const allSubnetIds = [...subnetIds, ...ownedSubnetIds];

  // Fetch posts with audience-based filtering
  const posts = await prisma.post.findMany({
    where: {
      OR: [
        // 1. User's own posts
        { userId: me },
        
        // 2. PUBLIC posts from anyone
        { visibility: "PUBLIC" },
        
        // 3. CONNECTIONS posts from connected users
        {
          AND: [
            { visibility: "CONNECTIONS" },
            { userId: { in: connectedUserIds } }
          ]
        },
        
        // 4. ACQUAINTANCES posts from acquaintances only
        {
          AND: [
            { visibility: "ACQUAINTANCES" },
            { userId: { in: Array.from(acquaintances) } }
          ]
        },
        
        // 5. STRANGERS posts from strangers only
        {
          AND: [
            { visibility: "STRANGERS" },
            { userId: { in: Array.from(strangers) } }
          ]
        },
        
        // 6. SUBNET posts from subnets user is a member of or owns
        {
          AND: [
            { visibility: "SUBNET" },
            { subNetId: { in: allSubnetIds } }
          ]
        }
      ]
    },
    orderBy: { createdAt: "desc" },
    include: { user: true },
    take: 50,
  });

  const toRelation = (authorId: string) =>
    authorId === me
      ? "SELF"
      : acquaintances.has(authorId)
      ? "ACQUAINTANCE"
      : strangers.has(authorId)
      ? "STRANGER"
      : followingIds.has(authorId)
      ? "FOLLOWING"
      : "NONE";

  res.json(
    posts.map((p: any) => ({
      id: p.id,
      userId: p.userId,
      content: p.content,
      media: p.media,
      orientation: p.orientation,
      visibility: p.visibility,
      createdAt: p.createdAt,
      user: { 
        id: p.user.id, 
        username: p.user.username,
        firstName: p.user.firstName,
        lastName: p.user.lastName,
        profilePhoto: p.user.profilePhoto
      },
      relation: toRelation(p.userId),
    }))
  );
});

// GET /posts/:postId - Get a single post with authorization
router.get("/posts/:postId", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = (req.user as any).id;
  const { postId } = req.params;

  try {
    const post = await prisma.post.findUnique({
      where: { id: postId },
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
      }
    });

    if (!post) {
      return res.status(404).send("Post not found");
    }

    // Check if user can view this post
    const canView = await canUserViewPost(me, post);
    if (!canView) {
      return res.status(403).send("You do not have permission to view this post");
    }

    res.json({
      id: post.id,
      userId: post.userId,
      content: post.content,
      media: post.media,
      orientation: post.orientation,
      visibility: post.visibility,
      groupId: post.groupId,
      subNetId: post.subNetId,
      createdAt: post.createdAt,
      user: post.user
    });
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// PATCH /posts/:postId - Update post content and/or visibility
router.patch("/posts/:postId", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = (req.user as any).id;
  const { postId } = req.params;
  const { content, visibility } = req.body ?? {};

  // Validate postId
  if (!postId || typeof postId !== "string") {
    return res.status(400).send("Invalid post ID");
  }

  // Check if post exists and user owns it
  const existingPost = await prisma.post.findUnique({
    where: { id: postId },
    select: { 
      id: true, 
      userId: true, 
      content: true, 
      visibility: true, 
      groupId: true,
      subNetId: true 
    },
  });

  if (!existingPost) {
    return res.status(404).send("Post not found");
  }

  if (existingPost.userId !== me) {
    return res.status(403).send("Can only update your own posts");
  }

  // Prepare update data
  const updateData: any = {};

  // Validate and update content if provided
  if (content !== undefined) {
    const text = String(content).trim();
    if (!text || text.length > 500) {
      return res.status(400).send("Invalid content");
    }
    updateData.content = text;
  }

  // Validate and update visibility if provided
  if (visibility !== undefined) {
    const validVisibilities = ["PUBLIC", "CONNECTIONS", "ACQUAINTANCES", "STRANGERS", "SUBNET"];
    if (!validVisibilities.includes(visibility)) {
      return res.status(400).send("Invalid visibility. Must be PUBLIC, CONNECTIONS, ACQUAINTANCES, STRANGERS, or SUBNET");
    }
    
    // If changing to SUBNET visibility, ensure post has a subNetId
    if (visibility === "SUBNET" && !existingPost.subNetId) {
      return res.status(400).send("Cannot set SUBNET visibility on posts without a subnet");
    }
    
    // Posts keep their context even if visibility changes
    updateData.visibility = visibility;
  }

  // Check if there's anything to update
  if (Object.keys(updateData).length === 0) {
    return res.status(400).send("No valid fields to update");
  }

  try {
    const updatedPost = await prisma.post.update({
      where: { id: postId },
      data: updateData,
      select: { 
        id: true, 
        content: true, 
        createdAt: true, 
        userId: true, 
        groupId: true, 
        visibility: true 
      },
    });

    res.status(200).json(updatedPost);
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// DELETE /posts/:postId - Delete a post
router.delete("/posts/:postId", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = (req.user as any).id;
  const { postId } = req.params;

  // Validate postId
  if (!postId || typeof postId !== "string") {
    return res.status(400).send("Invalid post ID");
  }

  try {
    // Check if post exists and get its details
    const existingPost = await prisma.post.findUnique({
      where: { id: postId },
      select: { 
        id: true, 
        userId: true, 
        groupId: true, 
        visibility: true 
      },
    });

    if (!existingPost) {
      return res.status(404).send("Post not found");
    }

    // Authorization logic
    let canDelete = false;

    // If the user is the author, they can always delete
    if (existingPost.userId === me) {
      canDelete = true;
    }
    // If the post is in a group, check if user is the group admin
    else if (existingPost.groupId) {
      const group = await prisma.group.findUnique({
        where: { id: existingPost.groupId },
        select: { adminId: true },
      });
      
      if (group && group.adminId === me) {
        canDelete = true;
      }
    }

    if (!canDelete) {
      return res.status(403).send("Can only delete your own posts or posts in groups you admin");
    }

    // Delete the post
    await prisma.post.delete({
      where: { id: postId },
    });

    return res.status(204).end();
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message.includes("Record to delete does not exist")) {
      return res.status(404).send("Post not found");
    }
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
