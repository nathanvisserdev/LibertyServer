
import { Router } from "express";
import jwt from "jsonwebtoken";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? "";
if (!JWT_SECRET) throw new Error("Missing JWT_SECRET in .env");

// --- Ping ---
router.get("/ping", (_req, res) => res.status(200).send("ok"));

// --- Auth middleware ---
import type { Request, Response, NextFunction } from "express";

export async function auth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).send("Missing token");
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (typeof payload === "object" && payload !== null && payload.id) {
      // Check if user has been banned since token was issued
      const user = await prisma.users.findUnique({
        where: { id: payload.id },
        select: { isBanned: true }
      });
      
      if (!user) {
        return res.status(401).send("User not found");
      }
      
      if (user.isBanned) {
        return res.status(403).send("Account banned");
      }
      
      req.user = payload;
    } else {
      req.user = undefined;
    }
    next();
  } catch {
    return res.status(401).send("Invalid token");
  }
}

export default router;
