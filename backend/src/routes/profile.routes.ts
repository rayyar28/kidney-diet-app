import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.middleware.js";

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        createdAt: true,
        patientProfile: true,
      },
    });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

const updateProfileSchema = z.object({
  dateOfBirth: z.string().datetime().optional(),
  sex: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  heightCm: z.number().positive().optional(),
  weightKg: z.number().positive().optional(),
  ckdStage: z.enum(["STAGE_1", "STAGE_2", "STAGE_3A", "STAGE_3B", "STAGE_4", "STAGE_5", "TRANSPLANT", "UNKNOWN"]).optional(),
  dialysisType: z.enum(["NONE", "HEMODIALYSIS", "PERITONEAL_DIALYSIS"]).optional(),
  dailySodiumLimitMg: z.number().int().positive().optional(),
  dailyPotassiumLimitMg: z.number().int().positive().optional(),
  dailyPhosphorusLimitMg: z.number().int().positive().optional(),
  dailyProteinLimitG: z.number().int().positive().optional(),
  dailyFluidLimitMl: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
});

profileRouter.put("/", async (req: AuthedRequest, res, next) => {
  try {
    const body = updateProfileSchema.parse(req.body);
    const userId = req.user!.id;
    const profile = await prisma.patientProfile.upsert({
      where: { userId },
      create: { userId, ...body, dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined },
      update: { ...body, dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined },
    });
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});
