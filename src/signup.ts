import { Router } from "express";
import bcrypt from "bcrypt";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

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

// --- Signup (email + password + firstName + lastName + username) ---
router.post("/signup", async (req, res) => {
  const { email, password, firstName, lastName, username, isPaid } = req.body ?? {};
  
  // Reject isPaid field if present in request body
  if (isPaid !== undefined) {
    return res.status(400).json({ error: "isPaid field is not allowed in signup request" });
  }
  
  // Check required fields
  if (!email || !password || !firstName || !lastName || !username) {
    return res.status(400).json({ error: "Missing required fields: email, password, firstName, lastName, username" });
  }

  // Validate email format (basic)
  const emailStr = String(email).toLowerCase().trim();
  if (!emailStr.includes("@") || emailStr.length < 3) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  // Validate password length
  if (String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters long" });
  }

  // Validate firstName
  const firstNameStr = String(firstName).trim();
  if (firstNameStr.length === 0 || firstNameStr.length > 50) {
    return res.status(400).json({ error: "firstName must be non-empty and at most 50 characters" });
  }

  // Validate lastName
  const lastNameStr = String(lastName).trim();
  if (lastNameStr.length === 0 || lastNameStr.length > 50) {
    return res.status(400).json({ error: "lastName must be non-empty and at most 50 characters" });
  }

  // Validate username format and length
  const usernameStr = String(username).toLowerCase().trim();
  const usernameRegex = /^[a-z0-9_.]{3,100}$/;
  if (!usernameRegex.test(usernameStr)) {
    return res.status(400).json({ error: "Username must be 3-100 characters and contain only lowercase letters, numbers, underscores, and periods" });
  }

  try {
    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    
    // Use Prisma transaction to create user, group, and roster entry
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the user
      const user = await tx.users.create({
        data: {
          email: emailStr,
          password: passwordHash,
          firstName: firstNameStr,
          lastName: lastNameStr,
          username: usernameStr,
          isPaid: false, // Explicitly set to false (cannot be set by client)
        },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          createdAt: true,
          isPrivate: true,
        },
      });

      // 2. Create their PERSONAL "Social Circle" group
      const group = await tx.groups.create({
        data: {
          name: "Social Circle",
          description: "Your personal group",
          groupType: "PERSONAL",
          adminId: user.id,
        },
      });

      // 3. Add user to their own group via GroupMember
      await tx.groupMember.create({
        data: {
          userId: user.id,
          groupId: group.id,
        },
      });

      return user;
    });

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error && "code" in err) {
      if (err.code === "P2002") {
        // Unique constraint violation
        const meta = (err as any).meta;
        if (meta?.target?.includes("email")) {
          return res.status(409).json({ error: "Email already exists" });
        } else if (meta?.target?.includes("username")) {
          return res.status(409).json({ error: "Username already exists" });
        } else {
          return res.status(409).json({ error: "Email or username already exists" });
        }
      }
    }
    
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    } else {
      return res.status(400).json({ error: String(err) });
    }
  }
});

export { router as signupRouter };
