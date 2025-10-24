import apn from "@parse/node-apn";
import { prismaClient as prisma } from "./prismaClient.js";

// APNs Provider configuration using P8 key
// Set environment variables: APN_KEY_ID, APN_TEAM_ID, APN_KEY_PATH, APN_BUNDLE_ID
const apnProvider = new apn.Provider({
  token: {
    key: process.env.APN_KEY_PATH || "", // Path to .p8 file
    keyId: process.env.APN_KEY_ID || "",
    teamId: process.env.APN_TEAM_ID || "",
  },
  production: process.env.NODE_ENV === "production", // Use sandbox for development
});

/**
 * Send a connection request push notification to a user
 * @param userId - The ID of the user receiving the connection request
 */
export async function sendConnectionNotification(userId: string): Promise<void> {
  try {
    // Increment the pending request count in the database
    const updatedUser = await prisma.users.update({
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
  await prisma.users.update({
    where: { id: userId },
    data: { pendingRequestCount: 0 },
  });
}
