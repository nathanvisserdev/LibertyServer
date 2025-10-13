
import { Router } from "express";
import { PrismaClient, GroupType, PostVisibility } from "./generated/prisma/index.js";
import { auth } from "./misc.js";

const prisma = new PrismaClient();
const router = Router();

// --- Create Post (≤500 chars) for Public Feed (auth required, no group) ---
router.post("/posts", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const { content } = req.body ?? {};

  if (!content || String(content).trim().length === 0 || String(content).length > 500) {
    return res.status(400).send("Invalid content");
  }

  try {
    const post = await prisma.posts.create({
      data: {
        userId: me.id,
        content: String(content),
      },
    });

    res.status(201).json({
      id: post.id,
      content: post.content,
      createdAt: post.createdAt,
      userId: post.userId,
    });
  } catch (e) {
    console.error(e);
    if (e instanceof Error) {
      res.status(400).json({ error: e.message });
    } else {
      res.status(400).json({ error: String(e) });
    }
  }
});

// --- Get Posts (optionally by group) with block filtering ---
router.get("/posts", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = (req.user as any).id;
  const groupId = typeof req.query.groupId === "string" ? req.query.groupId : undefined;

  const [iBlocked, blockedMe] = await Promise.all([
    prisma.blocks.findMany({ where: { blockerId: me }, select: { blockedId: true } }),
    prisma.blocks.findMany({ where: { blockedId: me }, select: { blockerId: true } }),
  ]);
  const blocked = new Set([
    ...iBlocked.map(b => b.blockedId),
    ...blockedMe.map(b => b.blockerId),
  ]);

  let groupWhere = undefined;
  if (groupId) {
  const g = await prisma.groups.findUnique({ where: { id: groupId as string } });
    if (!g) return res.status(404).send("group not found");

    if (g.groupType === "PERSONAL") {
      if (g.adminId !== me) return res.sendStatus(404);
    } else if (g.groupType === "PRIVATE") {
      const member = await prisma.groupRoster.findUnique({
        where: { userId_groupId: { userId: me, groupId: groupId as string } },
      });
      if (!member) return res.sendStatus(403);
    }
    groupWhere = { groupId };
  }

  const posts = await prisma.posts.findMany({
    where: {
      ...groupWhere,
      userId: { notIn: Array.from(blocked) },
    },
    include: { user: true, group: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  res.json(posts);
});


// GET /feed  -> posts from me, my acquaintances, my strangers, and users I follow
router.get("/feed", auth, async (req, res) => {
  const me = (req as any).user.id as string;

  const [undirected, following] = await Promise.all([
    prisma.connections.findMany({
      where: {
        type: { in: ["ACQUAINTANCE", "STRANGER"] },
        OR: [{ requesterId: me }, { requestedId: me }],
      },
      select: { requesterId: true, requestedId: true, type: true },
    }),
    prisma.connections.findMany({
      where: { type: "FOLLOW", requesterId: me },
      select: { requestedId: true },
    }),
  ]);

  const acquaintances = new Set<string>();
  const strangers     = new Set<string>();
  for (const r of undirected) {
    const other = r.requesterId === me ? r.requestedId : r.requesterId;
    (r.type === "ACQUAINTANCE" ? acquaintances : strangers).add(other);
  }
  const followingIds = new Set(following.map(r => r.requestedId));

  const authorIds = Array.from(new Set([me, ...acquaintances, ...strangers, ...followingIds]));

  const posts = await prisma.posts.findMany({
    where: { userId: { in: authorIds } },
    orderBy: { createdAt: "desc" },
    include: { user: true },
    take: 50,
  });

  const toRelation = (authorId: string) =>
    authorId === me
      ? "SELF"
      : acquaintances.has(authorId)
      ? "ACQUAINTANCE"
      : strangers.has(authorId)
      ? "STRANGER"
      : followingIds.has(authorId)
      ? "FOLLOWING"
      : "NONE";

  res.json(
    posts.map(p => ({
      id: p.id,
      userId: p.userId,
      content: p.content,
      createdAt: p.createdAt,
      user: { id: p.user.id, email: p.user.email },
      relation: toRelation(p.userId),
    }))
  );
});

export default router;
