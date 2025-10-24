import { Router } from "express";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "./r2.js";
import { auth } from "./misc.js";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();

/**
 * POST /uploads/presign
 * Generate a presigned URL for uploading a photo to Cloudflare R2
 * Body: { contentType: string }
 * Returns: { url, method, headersOrFields, key }
 */
router.post("/uploads/presign", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const userId = (req.user as any).id;
  const { contentType } = req.body ?? {};

  // Validate content type
  if (!contentType || typeof contentType !== "string") {
    return res.status(400).send("Invalid contentType");
  }

  // Validate that it's an image
  if (!contentType.startsWith("image/")) {
    return res.status(400).send("Only image files are allowed");
  }

  try {
    // Generate unique key for the photo
    const timestamp = Date.now();
    const extension = contentType.split("/")[1] || "jpg";
    const key = `photos/${userId}/${timestamp}.${extension}`;

    // Create presigned URL for PUT operation
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(r2, command, { expiresIn: 300 }); // 5 minutes

    return res.status(200).json({
      url,
      method: "PUT",
      headersOrFields: {
        "Content-Type": contentType,
      },
      key,
    });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    return res.status(500).send("Internal server error");
  }
});

/**
 * POST /users/me/photo
 * Update the user's photo URL after successful upload
 * Body: { key: string }
 */
router.post("/users/me/photo", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const userId = (req.user as any).id;
  const { key } = req.body ?? {};

  // Validate key
  if (!key || typeof key !== "string") {
    return res.status(400).send("Invalid key");
  }

  // Validate key prefix to ensure user can only set photos in their own directory
  const expectedPrefix = `photos/${userId}/`;
  if (!key.startsWith(expectedPrefix)) {
    return res.status(403).send("Key must start with photos/{userId}/");
  }

  try {
    // Build photo URL using CDN base URL
    const photoUrl = `${process.env.CDN_BASE_URL}/${key.replace(/^photos\//, "")}`;

    // Update user's photo URL in database
    const updatedUser = await prisma.users.update({
      where: { id: userId },
      data: { photo: photoUrl },
      select: {
        id: true,
        photo: true,
      },
    });

    return res.status(200).json({
      photo: updatedUser.photo,
    });
  } catch (error) {
    console.error("Error updating user photo:", error);
    return res.status(500).send("Internal server error");
  }
});

export default router;
