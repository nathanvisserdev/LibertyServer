import apn from "@parse/node-apn";
import { prismaClient as prisma } from "./prismaClient.js";

// Read the P8 key from environment variable
const apnKeyContent = process.env.APN_P8 || "";
const isTestEnvironment = process.env.NODE_ENV === "test";

// Only initialize APNs provider if we have a valid key or not in test environment
let apnProvider: apn.Provider | null = null;

if (apnKeyContent && apnKeyContent.includes("BEGIN PRIVATE KEY")) {
  try {
    apnProvider = new apn.Provider({
      token: {
        key: apnKeyContent,
        keyId: process.env.APN_KEY_ID || "",
        teamId: process.env.APN_TEAM_ID || "",
      },
      production: process.env.NODE_ENV === "production",
    });
    console.log("✅ APNs P8 key loaded successfully from environment");
  } catch (error) {
    console.error("❌ Failed to initialize APNs provider:", error);
  }
} else if (!isTestEnvironment) {
  console.warn("⚠️ APNs P8 key not found in environment - push notifications will be disabled");
}

/**
 * Send a connection request push notification to a user
 * @param userId - The ID of the user receiving the connection request
 */
export async function sendConnectionNotification(userId: string): Promise<void> {
  try {
    // Increment the pending request count in the database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        pendingRequestCount: {
          increment: 1,
        },
      },
      select: {
        pendingRequestCount: true,
        deviceTokens: {
          where: { platform: "ios" },
          select: { token: true },
        },
      },
    });

    console.log(`📬 Incremented pending count for user ${userId} to ${updatedUser.pendingRequestCount}`);

    // If no device tokens, nothing to send
    if (updatedUser.deviceTokens.length === 0) {
      console.log(`⚠️ No device tokens found for user ${userId}`);
      return;
    }

    // If APNs provider is not initialized, skip sending notifications
    if (!apnProvider) {
      console.log(`⚠️ APNs provider not initialized - skipping push notification for user ${userId}`);
      return;
    }

    // Create APNs notification
    const notification = new apn.Notification({
      alert: {
        title: "New Connection Request",
        body: "Someone wants to connect with you!",
      },
      badge: updatedUser.pendingRequestCount, // Set badge to pending count
      sound: "default",
      contentAvailable: true, // Enable background processing
      topic: process.env.APN_BUNDLE_ID || "com.libertysocial.app", // Your app's bundle ID
      payload: {
        type: "connection_request", // Custom data for app to handle
      },
    });

    // Send to all registered devices for this user
    const deviceTokens = updatedUser.deviceTokens.map((dt: any) => dt.token);
    const result = await apnProvider.send(notification, deviceTokens);

    // Log any failures
    if (result.failed.length > 0) {
      console.error("Failed to send notifications:", result.failed);
      
      // Remove invalid tokens from database
      for (const failure of result.failed) {
        if (failure.status === 410) {
          // Token is no longer valid, remove it
          await prisma.deviceToken.deleteMany({
            where: { token: failure.device },
          });
          console.log(`Removed invalid token: ${failure.device}`);
        }
      }
    }

    console.log(`Sent connection notification to ${result.sent.length} device(s)`);
  } catch (error) {
    console.error("Error sending connection notification:", error);
    throw error;
  }
}

/**
 * Reset the pending request count for a user (called when they view the requests)
 * @param userId - The ID of the user
 */
export async function resetPendingRequestCount(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { pendingRequestCount: 0 },
  });
}
