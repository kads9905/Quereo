import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  getDatabaseTypes,
  testUnsavedConnection,
  createConnection,
  listConnections,
  getConnection,
  updateConnection,
  deleteConnection,
  testSavedConnection,
} from "../controllers/connection.controller.js";
import { runQuery } from "../controllers/query.controller.js";
import { explainQuery, getSlowQueries } from "../controllers/performance.controller.js";
import { getSchema } from "../controllers/schema.controller.js";
import { suggestIndexes, tryIndex, getUnusedIndexes } from "../controllers/advisor.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// Each of these makes our server open a connection to a host the user typed in.
// Limiting them stops someone using Quereo to scan hosts and ports.
const connectAttemptLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user._id),
  message: { success: false, message: "Too many connection attempts, wait a minute", errors: [], data: null },
});

router.use(verifyJWT);

router.get("/types", getDatabaseTypes);
router.post("/test", connectAttemptLimiter, testUnsavedConnection);

router.route("/").get(listConnections).post(connectAttemptLimiter, createConnection);
router.route("/:id").get(getConnection).patch(connectAttemptLimiter, updateConnection).delete(deleteConnection);

router.post("/:id/test", connectAttemptLimiter, testSavedConnection);
router.post("/:id/query", runQuery);
router.post("/:id/explain", explainQuery);
router.get("/:id/slow-queries", getSlowQueries);
router.get("/:id/schema", getSchema);
router.post("/:id/advisor/suggest", suggestIndexes);
router.post("/:id/advisor/try", tryIndex);
router.get("/:id/advisor/unused-indexes", getUnusedIndexes);

export default router;
