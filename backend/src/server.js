// Must be the first import: ES imports are hoisted, so dotenv has to load
// before app.js reads process.env
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import { validateEnv } from "./config/env.js";
import app from "./app.js";
import { closeAllAdapters } from "./adapters/index.js";
import { startScheduler, stopScheduler } from "./services/scheduler.service.js";

const PORT = process.env.PORT || 8000;

try {
  validateEnv();
  await connectDB();
} catch (error) {
  console.error("Server failed to start:", error.message);
  process.exit(1);
}

const server = app.listen(PORT, () => {
  console.log(`Quereo API running on port ${PORT}`);
});

// The scheduler lives in server.js (not app.js) so tests can drive it by hand
startScheduler();

// Close database pools cleanly on Ctrl+C or when the host stops the process
const shutdown = async () => {
  stopScheduler();
  server.close();
  await closeAllAdapters();
  await mongoose.disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
