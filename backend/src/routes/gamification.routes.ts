import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.middleware.js";
import { getGamificationSummary } from "../services/gamification.service.js";

export const gamificationRouter = Router();
gamificationRouter.use(requireAuth);

gamificationRouter.get("/summary", async (req: AuthedRequest, res, next) => {
  try {
    const summary = await getGamificationSummary(req.user!.id);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});
