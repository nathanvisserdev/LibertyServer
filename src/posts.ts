
import { Router } from "express";
import { PrismaClient, GroupType, PostVisibility } from "./generated/prisma/index.js";
import { auth } from "./misc.js";

const prisma = new PrismaClient();
const router = Router();

// --- Create Post (≤500 chars). Public by default; or to a group if groupId provided ---
router.post("/posts", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  const me = req.user as any;
  const { content, groupId } = req.body ?? {};

  const text = String(content ?? "").trim();
  if (!text || text.length > 500) return res.status(400).send("Invalid content");

  // Optional: block banned users from posting
  const meRow = await prisma.users.findUnique({ where: { id: me.id }, select: { isBanned: true } });
  if (!meRow) return res.status(404).send("User not found");
  if (meRow.isBanned) return res.status(403).send("account banned");

  try {
    // No groupId -> public post
    if (!groupId) {
      const post = await prisma.posts.create({
        data: { userId: me.id, content: text, visibility: "PUBLIC" },
        select: { id: true, content: true, createdAt: true, userId: true, groupId: true, visibility: true },
      });
      return res.status(201).json(post);
    }

    // With groupId -> validate group & membership policy
    const group = await prisma.groups.findUnique({
      where: { id: String(groupId) },
      select: { id: true, groupType: true },
    });
    if (!group) return res.status(404).send("Group not found");

    // Membership required for PRIVATE or PERSONAL; PUBLIC can be open-post (policy choice)
    if (group.groupType === "PRIVATE" || group.groupType === "PERSONAL") {
      const member = await prisma.groupRoster.findUnique({
        where: { userId_groupId: { userId: me.id, groupId: group.id } },
        select: { membershipId: true },
      });
      if (!member) return res.status(403).send("Not a member of this group");
    }
    // PUBLIC group posts require membership as well (policy choice)
    else {
      const member = await prisma.groupRoster.findUnique({
        where: { userId_groupId: { userId: me.id, groupId: group.id } },
        select: { membershipId: true },
      });
      if (!member) return res.status(403).send("Not a member of this group");
    }

    const post = await prisma.posts.create({
      data: { userId: me.id, groupId: group.id, content: text, visibility: "GROUP" }, // force GROUP visibility
      select: { id: true, content: true, createdAt: true, userId: true, groupId: true, visibility: true },
    });
    return res.status(201).json(post);
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
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
