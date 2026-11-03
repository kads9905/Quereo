import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getAiStatus, explainWithAi, questionToSql } from "../controllers/ai.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

// Every AI call costs money and counts against the Groq rate limit
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user._id),
  message: { success: false, message: "Too many AI requests, wait a minute", errors: [], data: null },
});

// Mounted at /api/connections/:id/ai
const connectionAiRouter = Router({ mergeParams: true });
connectionAiRouter.use(verifyJWT, aiLimiter);
connectionAiRouter.post("/explain", explainWithAi);
connectionAiRouter.post("/sql", questionToSql);

// Mounted at /api/ai
const aiRouter = Router();
aiRouter.get("/status", verifyJWT, getAiStatus);

export { connectionAiRouter, aiRouter };
