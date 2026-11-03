import { Router } from "express";
import {
  createMonitor,
  listMonitors,
  getMonitor,
  updateMonitor,
  deleteMonitor,
  runMonitorNow,
  sendTestAlert,
  listRuns,
  getMonitorStats,
  listIncidents,
} from "../controllers/monitor.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const monitorRouter = Router();
monitorRouter.use(verifyJWT);

monitorRouter.route("/").get(listMonitors).post(createMonitor);
monitorRouter.route("/:id").get(getMonitor).patch(updateMonitor).delete(deleteMonitor);
monitorRouter.post("/:id/run", runMonitorNow);
monitorRouter.post("/:id/test-alert", sendTestAlert);
monitorRouter.get("/:id/runs", listRuns);
monitorRouter.get("/:id/stats", getMonitorStats);

const incidentRouter = Router();
incidentRouter.use(verifyJWT);
incidentRouter.get("/", listIncidents);

export { monitorRouter, incidentRouter };
