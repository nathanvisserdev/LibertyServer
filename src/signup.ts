import { Router } from "express";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();

// --- Check username/email availability ---
router.post("/availability", async (req, res) => {
  try {
    const { username, email } = req.body ?? {};

    // Validate that exactly one field is provided
    // Check for undefined or null (but allow empty strings)
    const hasUsername = username !== undefined && username !== null;
    const hasEmail = email !== undefined && email !== null;

    if (!hasUsername && !hasEmail) {
      return res.status(400).json({ 
        error: "Either username or email must be provided" 
      });
    }

    if (hasUsername && hasEmail) {
      return res.status(400).json({ 
        error: "Provide either username or email, not both" 
      });
    }

    // Query database to check if the field exists
    let existingUser;
    if (hasUsername) {
      existingUser = await prisma.users.findUnique({
        where: { username },
        select: { id: true }
      });
    } else {
      existingUser = await prisma.users.findUnique({
        where: { email },
        select: { id: true }
      });
    }

    // Return availability status
    return res.status(200).json({ 
      available: !existingUser 
    });

  } catch (error) {
    console.error("Error checking availability:", error);
    return res.status(500).json({ 
      error: "Internal server error" 
    });
  }
});

export { router as signupRouter };
