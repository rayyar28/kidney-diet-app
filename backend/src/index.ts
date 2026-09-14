import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { mealsRouter } from "./routes/meals.routes.js";
import { photosRouter } from "./routes/photos.routes.js";
import { gamificationRouter } from "./routes/gamification.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { errorMiddleware } from "./middleware/error.middleware.js";

const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/meals", mealsRouter);
app.use("/api/photos", photosRouter);
app.use("/api/gamification", gamificationRouter);
app.use("/api/profile", profileRouter);

app.use(errorMiddleware);

app.listen(env.port, () => {
  console.log(`API server listening on port ${env.port}`);
});
