
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient, GroupType } from "./generated/prisma/index.js";
import { auth } from "./misc.js";

const prisma = new PrismaClient();
const router = Router();

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const JWT_SECRET = process.env.JWT_SECRET ?? "";
if (!JWT_SECRET) throw new Error("Missing JWT_SECRET in .env");

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
  const usernameRegex = /^[a-z0-9_.]{3,32}$/;
  if (!usernameRegex.test(usernameStr)) {
    return res.status(400).json({ error: "Username must be 3-32 characters and contain only lowercase letters, numbers, underscores, and periods" });
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

      // 3. Add user to their own group via GroupRoster
      await tx.groupRoster.create({
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

// --- Login ---
router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).send("missing fields");

  const user = await prisma.users.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!user) return res.status(401).send("invalid credentials");

  const ok = await bcrypt.compare(String(password), user.password);
  if (!ok) return res.status(401).send("invalid credentials");

  if (user.isBanned) return res.status(403).send("account banned");

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "1h" });
  return res.status(200).json({ accessToken: token });
});

export default router;
