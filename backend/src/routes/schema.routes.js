import { Router } from "express";
import {
  createSnapshot,
  listSnapshots,
  getSnapshot,
  deleteSnapshot,
  diffSchema,
} from "../controllers/schema.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(verifyJWT);

router.route("/snapshots").get(listSnapshots).post(createSnapshot);
router.route("/snapshots/:id").get(getSnapshot).delete(deleteSnapshot);
router.post("/diff", diffSchema);

export default router;
