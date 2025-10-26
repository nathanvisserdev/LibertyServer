import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const JWT_SECRET = process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'test' ? 'test-jwt-secret' : '');
if (!JWT_SECRET) throw new Error("Missing JWT_SECRET in .env");

// Email validation regex
const EMAIL_REGEX = /^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

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
      // Lowercase username for consistency
      const usernameStr = String(username).toLowerCase().trim();
      existingUser = await prisma.users.findUnique({
        where: { username: usernameStr },
        select: { id: true }
      });
    } else {
      // Lowercase email for consistency
      const emailStr = String(email).toLowerCase().trim();
      
      // Validate email format
      if (!isValidEmail(emailStr)) {
        return res.status(400).json({ 
          error: "Invalid email format" 
        });
      }
      
      existingUser = await prisma.users.findUnique({
        where: { email: emailStr },
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

// --- Signup (email + password + firstName + lastName + username + dateOfBirth + gender) ---
router.post("/signup", async (req, res) => {
  const { 
    email, password, firstName, lastName, username, dateOfBirth, gender,
    phoneNumber, profilePhoto, about, isPrivate, isPaid 
  } = req.body ?? {};
  
  // Reject isPaid field if present in request body
  if (isPaid !== undefined) {
    return res.status(400).json({ error: "isPaid field is not allowed in signup request" });
  }
  
  // Check required fields
  if (!email || !password || !firstName || !lastName || !username || !dateOfBirth || !gender || !profilePhoto || isPrivate === undefined) {
    return res.status(400).json({ error: "Missing required fields: email, password, firstName, lastName, username, dateOfBirth, gender, profilePhoto, isPrivate" });
  }

  // Validate email format (basic)
  const emailStr = String(email).toLowerCase().trim();
  if (!isValidEmail(emailStr)) {
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

  // Validate dateOfBirth (must be a valid date and user must be at least 13 years old)
  const dobDate = new Date(dateOfBirth);
  if (isNaN(dobDate.getTime())) {
    return res.status(400).json({ error: "Invalid date format for dateOfBirth" });
  }
  const thirteenYearsAgo = new Date();
  thirteenYearsAgo.setFullYear(thirteenYearsAgo.getFullYear() - 13);
  if (dobDate > thirteenYearsAgo) {
    return res.status(400).json({ error: "User must be at least 13 years old" });
  }

  // Validate gender (must be one of the valid enum values)
  const validGenders = ['MALE', 'FEMALE', 'OTHER'];
  const genderStr = String(gender).toUpperCase();
  if (!validGenders.includes(genderStr)) {
    return res.status(400).json({ error: "Invalid gender value. Must be one of: MALE, FEMALE, OTHER" });
  }

  // Validate optional fields
  if (phoneNumber !== undefined && phoneNumber !== null) {
    const phoneStr = String(phoneNumber).trim();
    if (phoneStr.length > 0 && phoneStr.length > 20) {
      return res.status(400).json({ error: "phoneNumber must be at most 20 characters" });
    }
  }

  if (about !== undefined && about !== null) {
    const aboutStr = String(about).trim();
    if (aboutStr.length > 500) {
      return res.status(400).json({ error: "about must be at most 500 characters" });
    }
  }

  // Validate profilePhoto (required)
  const photoStr = String(profilePhoto).trim();
  if (photoStr.length === 0) {
    return res.status(400).json({ error: "profilePhoto is required" });
  }
  if (photoStr.length > 500) {
    return res.status(400).json({ error: "profilePhoto must be at most 500 characters" });
  }

  // Validate isPrivate (required boolean)
  if (typeof isPrivate !== "boolean") {
    return res.status(400).json({ error: "isPrivate must be a boolean value" });
  }

  try {
    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    
    // Use Prisma transaction to create user, group, and roster entry
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the user
      const userData: any = {
        email: emailStr,
        password: passwordHash,
        firstName: firstNameStr,
        lastName: lastNameStr,
        username: usernameStr,
        dateOfBirth: dobDate,
        gender: genderStr,
        profilePhoto: photoStr,
        isPrivate: isPrivate,
        isPaid: false, // Explicitly set to false (cannot be set by client)
      };

      // Add optional fields if provided
      if (phoneNumber !== undefined && phoneNumber !== null && String(phoneNumber).trim().length > 0) {
        userData.phoneNumber = String(phoneNumber).trim();
      }
      if (about !== undefined && about !== null && String(about).trim().length > 0) {
        userData.about = String(about).trim();
      }

      const user = await tx.users.create({
        data: userData,
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          gender: true,
          phoneNumber: true,
          profilePhoto: true,
          about: true,
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

    // Generate JWT token for the new user
    const token = jwt.sign({ id: result.id }, JWT_SECRET, { expiresIn: "1h" });

    res.status(201).json({
      ...result,
      accessToken: token
    });
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
