

// Only load .env in non-test environments
// Tests set DATABASE_URL before importing this file
if (process.env.NODE_ENV !== 'test') {
  await import("dotenv/config");
}

import express from "express";
import cors from "cors";
import authRouter from "./auth.js";
import blocksRouter from "./blocks.js";
import postsRouter from "./posts.js";
import groupsRouter from "./groups.js";
import miscRouter from "./misc.js";
import usersRouter from "./users.js";
import searchRouter from "./search.js";
import profileRouter from "./profile.js";
import connectionsRouter from "./connections.js";
import devicesRouter from "./devices.js";
import mediaRouter from "./media.js";
import mediaReadRouter from "./mediaRead.js";
import { signupRouter } from "./signup.js";
import subnetsRouter from "./subnets.js";
import subnetMembersRouter from "./subnetMembers.js";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN?.split(",").map(s => s.trim());
app.use(cors({ origin: CORS_ORIGIN || true }));

app.use(miscRouter);
app.use(authRouter);
app.use(signupRouter);
app.use(usersRouter);
app.use(blocksRouter);
app.use(postsRouter);
app.use(groupsRouter);
app.use(searchRouter);
app.use(profileRouter);
app.use(connectionsRouter);
app.use(devicesRouter);
app.use(mediaRouter);
app.use(mediaReadRouter);
app.use(subnetsRouter);
app.use(subnetMembersRouter);

if (process.env.NODE_ENV !== "test") {
  app.listen(process.env.PORT || 3000, () =>
    console.log("Server on http://127.0.0.1:3000")
  );
}

export { app };
