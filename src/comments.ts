import express from "express";
import { prismaClient as prisma } from "./prismaClient.js";
import { auth } from "./misc.js";

const router = express.Router();

// POST /posts/:postId/comments - Create a comment
router.post("/posts/:postId/comments", auth, async (req, res) => {
  const { postId } = req.params;
  const { content, parentId } = req.body;
  const userId = req.user?.id;

  try {
    // Verify post exists
    const post = await prisma.post.findUnique({
      where: { postId },
    });

    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    // If parentId is provided, verify it exists and belongs to this post
    if (parentId) {
      const parentComment = await prisma.comment.findFirst({
        where: {
          commentId: parentId,
          postId: postId,
        },
      });

      if (!parentComment) {
        return res.status(404).json({ error: "Parent comment not found" });
      }
    }

    // Validate content
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "Comment content is required" });
    }

    if (content.length > 5000) {
      return res.status(400).json({ error: "Comment content too long (max 5000 characters)" });
    }

    // Create comment
    const comment = await prisma.comment.create({
      data: {
        content: content.trim(),
        userId,
        postId,
        parentId: parentId || null,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePhoto: true,
          },
        },
      },
    });

    res.status(201).json(comment);
  } catch (error) {
    console.error("Error creating comment:", error);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

// GET /posts/:postId/comments - Fetch comments for a post
router.get("/posts/:postId/comments", auth, async (req, res) => {
  const { postId } = req.params;
  const { cursor, limit = "50", parentId } = req.query;

  try {
    // Verify post exists
    const post = await prisma.post.findUnique({
      where: { postId },
    });

    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const take = Math.min(parseInt(limit as string) || 50, 100);

    const where: any = {
      postId,
    };

    // Filter by parentId if provided (null for top-level comments)
    if (parentId !== undefined) {
      where.parentId = parentId === "null" || parentId === "" ? null : (parentId as string);
    }

    const comments = await prisma.comment.findMany({
      where,
      take: take + 1,
      ...(cursor && {
        cursor: { commentId: cursor as string },
        skip: 1,
      }),
      orderBy: {
        createdAt: "desc",
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePhoto: true,
          },
        },
      },
    });

    const hasMore = comments.length > take;
    const commentsToReturn = hasMore ? comments.slice(0, -1) : comments;
    const nextCursor = hasMore && commentsToReturn.length > 0 ? commentsToReturn[commentsToReturn.length - 1]?.commentId : null;

    res.json({
      comments: commentsToReturn.map((c: any) => ({
        commentId: c.commentId,
        content: c.content,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        userId: c.userId,
        postId: c.postId,
        parentId: c.parentId,
        user: c.user,
      })),
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// PATCH /comments/:commentId - Update a comment
router.patch("/comments/:commentId", auth, async (req, res) => {
  const { commentId } = req.params;
  const { content } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Find the comment
    const comment = await prisma.comment.findUnique({
      where: { commentId },
      include: {
        post: {
          select: {
            userId: true,
            groupId: true,
          },
        },
      },
    });

    if (!comment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    // Check authorization: only comment author can edit
    if (comment.userId !== userId) {
      return res.status(403).json({ error: "You can only edit your own comments" });
    }

    // Validate content
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "Comment content is required" });
    }

    if (content.length > 5000) {
      return res.status(400).json({ error: "Comment content too long (max 5000 characters)" });
    }

    // Update comment
    const updatedComment = await prisma.comment.update({
      where: { commentId },
      data: {
        content: content.trim(),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePhoto: true,
          },
        },
      },
    });

    res.json({
      commentId: updatedComment.commentId,
      content: updatedComment.content,
      createdAt: updatedComment.createdAt.toISOString(),
      updatedAt: updatedComment.updatedAt.toISOString(),
      userId: updatedComment.userId,
      postId: updatedComment.postId,
      parentId: updatedComment.parentId,
      user: updatedComment.user,
    });
  } catch (error) {
    console.error("Error updating comment:", error);
    res.status(500).json({ error: "Failed to update comment" });
  }
});

// DELETE /comments/:commentId - Delete a comment
router.delete("/comments/:commentId", auth, async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Find the comment
    const comment = await prisma.comment.findUnique({
      where: { commentId },
      include: {
        post: {
          select: {
            userId: true,
            groupId: true,
          },
        },
      },
    });

    if (!comment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    // Check authorization: comment author or post author can delete
    const isCommentAuthor = comment.userId === userId;
    const isPostAuthor = comment.post.userId === userId;

    if (!isCommentAuthor && !isPostAuthor) {
      return res.status(403).json({ error: "You can only delete your own comments or comments on your posts" });
    }

    // Delete the comment
    await prisma.comment.delete({
      where: { commentId },
    });

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting comment:", error);
    res.status(500).json({ error: "Failed to delete comment" });
  }
});

export default router;
