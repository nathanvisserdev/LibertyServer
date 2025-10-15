

import "dotenv/config";
import express from "express";
import cors from "cors";
import authRouter from "./auth.js";
import blocksRouter from "./blocks.js";
import postsRouter from "./posts.js";
import groupsRouter from "./groups.js";
import miscRouter from "./misc.js";
import usersRouter from "./users.js";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN?.split(",").map(s => s.trim());
app.use(cors({ origin: CORS_ORIGIN || true }));

app.use(miscRouter);
app.use(authRouter);
app.use(usersRouter);
app.use(blocksRouter);
app.use(postsRouter);
app.use(groupsRouter);

if (process.env.NODE_ENV !== "test") {
  app.listen(process.env.PORT || 3000, () =>
    console.log("Server on http://127.0.0.1:3000")
  );
}

export { app };
