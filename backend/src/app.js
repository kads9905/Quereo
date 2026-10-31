import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { corsOriginOption } from "./config/env.js";
import userRouter from "./routes/user.routes.js";
import connectionRouter from "./routes/connection.routes.js";
import { historyRouter, savedQueryRouter } from "./routes/query.routes.js";
import { monitorRouter, incidentRouter } from "./routes/monitor.routes.js";
import schemaRouter from "./routes/schema.routes.js";
import { connectionAiRouter, aiRouter } from "./routes/ai.routes.js";

const app = express();

// Don't advertise the framework in every response
app.disable("x-powered-by");

if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

app.use(cors({ origin: corsOriginOption(), credentials: true }));
// SQL can be long, but nothing we accept needs more than this
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// Slows down password guessing. Only failed attempts count.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts, please try again later", errors: [], data: null },
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    data: { status: "ok", mongo: mongoose.connection.readyState === 1 ? "up" : "down" },
  });
});

// A plain test page at http://localhost:8000/ (development only, never in production)
if (process.env.NODE_ENV !== "production") {
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dev-ui")));
}

app.use(["/api/users/login", "/api/users/register", "/api/users/google"], authLimiter);
app.use("/api/users", userRouter);
app.use("/api/connections/:id/ai", connectionAiRouter);
app.use("/api/connections", connectionRouter);
app.use("/api/ai", aiRouter);
app.use("/api/history", historyRouter);
app.use("/api/saved-queries", savedQueryRouter);
app.use("/api/monitors", monitorRouter);
app.use("/api/incidents", incidentRouter);
app.use("/api/schema", schemaRouter);

app.use("/api", notFoundHandler);
app.use(errorHandler);

export default app;
