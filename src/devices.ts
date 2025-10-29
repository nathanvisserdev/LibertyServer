import { Router } from "express";
import { auth } from "./misc.js";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();

/**
 * POST /devices/register
 * Register a device token for push notifications
 * Body: { token: string, platform: "ios" | "android" }
 */
router.post("/devices/register", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const userId = (req.user as any).id;
  const { token, platform } = req.body ?? {};

  // Validate input
  if (!token || typeof token !== "string") {
    return res.status(400).send("Invalid token");
  }
  if (!platform || !["ios", "android"].includes(platform)) {
    return res.status(400).send("Invalid platform: must be ios or android");
  }

  try {
    // Upsert device token (create or update)
    const deviceToken = await prisma.deviceToken.upsert({
      where: { token },
      update: {
        userId,
        platform,
        updatedAt: new Date(),
      },
      create: {
        userId,
        token,
        platform,
      },
    });

    return res.status(200).json({
      message: "Device registered successfully",
      deviceId: deviceToken.id,
    });
  } catch (error) {
    console.error("Device registration error:", error);
    return res.status(500).send("Internal server error");
  }
});

/**
 * DELETE /devices/unregister
 * Unregister a device token (called on logout)
 * Body: { token: string }
 */
router.delete("/devices/unregister", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const userId = (req.user as any).id;
  const { token } = req.body ?? {};

  // Validate input
  if (!token || typeof token !== "string") {
    return res.status(400).send("Invalid token");
  }

  try {
    // Delete device token for this user
    await prisma.deviceToken.deleteMany({
      where: {
        userId,
        token,
      },
    });

    return res.status(200).json({
      message: "Device unregistered successfully",
    });
  } catch (error) {
    console.error("Device unregistration error:", error);
    return res.status(500).send("Internal server error");
  }
});

/**
 * GET /devices/pending-count
 * Get the current pending request count for the authenticated user
 */
router.get("/devices/pending-count", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const userId = (req.user as any).id;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { pendingRequestCount: true },
    });

    if (!user) {
      return res.status(404).send("User not found");
    }

    console.log(`📬 User ${userId} has ${user.pendingRequestCount} pending requests`);

    return res.status(200).json({
      pendingRequestCount: user.pendingRequestCount,
    });
  } catch (error) {
    console.error("Get pending count error:", error);
    return res.status(500).send("Internal server error");
  }
});

export default router;
