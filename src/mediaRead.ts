import { Router } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "./r2.js";
import { auth } from "./misc.js";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();

router.post("/media/presign-read", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Unauthorized");
  }
  const userId = (req.user as any).id;
  
  const { key, postId } = req.body ?? {};
  if (typeof key !== "string") {
    return res.status(400).send("Missing key");
  }

  // Allow viewing others' profile photos; enforce prefix
  if (!key.startsWith("photos/")) {
    return res.status(400).send("Invalid key");
  }

  // If this media is associated with a post, check authorization
  if (postId && typeof postId === "string") {
    try {
      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: {
          id: true,
          userId: true,
          visibility: true,
          subNetId: true,
          groupId: true,
          media: true
        }
      });

      if (!post) {
        return res.status(404).send("Post not found");
      }

      // Verify the media key matches the post
      if (post.media !== key) {
        return res.status(403).send("Media key does not match post");
      }

      // Check if user can view this post
      const canView = await canUserViewPost(userId, post);
      if (!canView) {
        return res.status(403).send("You do not have permission to view this post's media");
      }
    } catch (error) {
      console.error("Error checking post authorization:", error);
      return res.status(500).send("Failed to verify post authorization");
    }
  }

  try {
    const cmd = new GetObjectCommand({ 
      Bucket: process.env.R2_BUCKET!, 
      Key: key 
    });
    
    const url = await getSignedUrl(r2, cmd, { expiresIn: 300 }); // 5 minutes
    const expiresAt = Date.now() + 300_000;
    
    console.log(`📸 Generated presigned read URL for key: ${key}, expires at: ${new Date(expiresAt).toISOString()}`);
    
    return res.json({ url, expiresAt });
  } catch (error) {
    console.error("Error generating presigned read URL:", error);
    return res.status(500).send("Failed to generate presigned URL");
  }
});

// --- Helper: Check if user can view a post (copied from posts.ts for media authorization) ---
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

  // GROUP posts - user must be a member of the group
  if (post.visibility === "GROUP" && post.groupId) {
    const member = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: userId, groupId: post.groupId } }
    });
    return !!member;
  }

  return false;
}

export default router;
