import { Router } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "./r2.js";
import { auth } from "./misc.js";

const router = Router();

router.post("/media/presign-read", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Unauthorized");
  }
  
  const { key } = req.body ?? {};
  if (typeof key !== "string") {
    return res.status(400).send("Missing key");
  }

  // Allow viewing others' profile photos; enforce prefix
  if (!key.startsWith("photos/")) {
    return res.status(400).send("Invalid key");
  }

  try {
    const cmd = new GetObjectCommand({ 
      Bucket: process.env.R2_BUCKET!, 
      Key: key 
    });
    
    const url = await getSignedUrl(r2, cmd, { expiresIn: 300 }); // 5 minutes
    const expiresAt = Date.now() + 300_000;
    
    console.log(`📸 Generated presigned read URL for key: ${key}, expires at: ${new Date(expiresAt).toISOString()}`);
    
    res.json({ url, expiresAt });
  } catch (error) {
    console.error("Error generating presigned read URL:", error);
    return res.status(500).send("Failed to generate presigned URL");
  }
});

export default router;
