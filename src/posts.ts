
import { Router } from "express";
import { GroupPrivacy, PostVisibility } from "./generated/prisma/index.js";
import { auth } from "./misc.js";
import { prismaClient as prisma } from "./prismaClient.js";
const router = Router();

// --- Create Post (≤500 chars). Public by default; or to a group if groupId provided ---
router.post("/posts", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const { content, media, groupId, imageWidth, imageHeight } = req.body ?? {};

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

  // Optional: block banned users from posting
  const meRow = await prisma.users.findUnique({ where: { id: me.id }, select: { isBanned: true } });
  if (!meRow) return res.status(404).send("User not found");
  if (meRow.isBanned) return res.status(403).send("account banned");

  try {
    // Prepare post data
    const postData: any = {
      userId: me.id,
      content: text || null,
      media: mediaKey || null,
      orientation: orientation,
    };

    // No groupId -> public post
    if (!groupId) {
      postData.visibility = "PUBLIC";
      const post = await prisma.posts.create({
        data: postData,
        select: { id: true, content: true, media: true, createdAt: true, userId: true, groupId: true, visibility: true },
      });
      return res.status(201).json(post);
    }

    // With groupId -> validate group & membership policy
    const group = await prisma.groups.findUnique({
      where: { id: String(groupId) },
      select: { id: true, groupType: true },
    });
    if (!group) return res.status(404).send("Group not found");

    // Membership required for PRIVATE or PERSONAL; PUBLIC can be open-post (policy choice)
    if (group.groupType === "PRIVATE" || group.groupType === "PERSONAL") {
      const member = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId: me.id, groupId: group.id } },
        select: { membershipId: true },
      });
      if (!member) return res.status(403).send("Not a member of this group");
    }
    // PUBLIC group posts require membership as well (policy choice)
    else {
      const member = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId: me.id, groupId: group.id } },
        select: { membershipId: true },
      });
      if (!member) return res.status(403).send("Not a member of this group");
    }

    postData.groupId = group.id;
    postData.visibility = "GROUP"; // force GROUP visibility

    const post = await prisma.posts.create({
      data: postData,
      select: { id: true, content: true, media: true, createdAt: true, userId: true, groupId: true, visibility: true },
    });
    return res.status(201).json(post);
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});


// GET /feed  -> posts from me, my acquaintances, my strangers, and users I follow
router.get("/feed", auth, async (req, res) => {
  const me = (req as any).user.id as string;

  const [undirected, following] = await Promise.all([
    prisma.connections.findMany({
      where: {
        type: { in: ["ACQUAINTANCE", "STRANGER"] },
        OR: [{ requesterId: me }, { requestedId: me }],
      },
      select: { requesterId: true, requestedId: true, type: true },
    }),
    prisma.connections.findMany({
      where: { type: "IS_FOLLOWING", requesterId: me },
      select: { requestedId: true },
    }),
  ]);

  const acquaintances = new Set<string>();
  const strangers     = new Set<string>();
  for (const r of undirected) {
    const other = r.requesterId === me ? r.requestedId : r.requesterId;
    (r.type === "ACQUAINTANCE" ? acquaintances : strangers).add(other);
  }
  const followingIds = new Set(following.map(r => r.requestedId));

  const authorIds = Array.from(new Set([me, ...acquaintances, ...strangers, ...followingIds]));

  const posts = await prisma.posts.findMany({
    where: { userId: { in: authorIds } },
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
    posts.map(p => ({
      id: p.id,
      userId: p.userId,
      content: p.content,
      media: p.media,
      orientation: p.orientation,
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
  const existingPost = await prisma.posts.findUnique({
    where: { id: postId },
    select: { id: true, userId: true, content: true, visibility: true, groupId: true },
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
    if (!["PUBLIC", "GROUP"].includes(visibility)) {
      return res.status(400).send("Invalid visibility. Must be PUBLIC or GROUP");
    }
    
    // If changing to GROUP visibility, ensure post has a groupId
    if (visibility === "GROUP" && !existingPost.groupId) {
      return res.status(400).send("Cannot set GROUP visibility on posts without a group");
    }
    
    // If changing to PUBLIC visibility, ensure post is not in a group
    if (visibility === "PUBLIC" && existingPost.groupId) {
      return res.status(400).send("Cannot set PUBLIC visibility on group posts");
    }
    
    updateData.visibility = visibility;
  }

  // Check if there's anything to update
  if (Object.keys(updateData).length === 0) {
    return res.status(400).send("No valid fields to update");
  }

  try {
    const updatedPost = await prisma.posts.update({
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
    const existingPost = await prisma.posts.findUnique({
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
      const group = await prisma.groups.findUnique({
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
    await prisma.posts.delete({
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
