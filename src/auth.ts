
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prismaClient as prisma } from "./prismaClient.js";
const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'test' ? 'test-jwt-secret' : '');
if (!JWT_SECRET) throw new Error("Missing JWT_SECRET in .env");

// --- Login ---
router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).send("missing fields");

  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!user) return res.status(401).send("invalid credentials");

  const ok = await bcrypt.compare(String(password), user.password);
  if (!ok) return res.status(401).send("invalid credentials");

  if (user.isBanned) return res.status(403).send("account banned");

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "1h" });
  return res.status(200).json({ accessToken: token });
});

export default router;
