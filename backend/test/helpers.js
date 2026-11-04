import crypto from "crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";

// Test config is set before the app is imported
process.env.NODE_ENV = "test";
process.env.ACCESS_TOKEN_SECRET = "test-secret";
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

// Sample databases from docker-compose.yml (override with env vars if needed)
const SAMPLE_DATABASES = {
  postgres: {
    type: "postgres",
    host: process.env.TEST_PG_HOST || "localhost",
    port: Number(process.env.TEST_PG_PORT || 5433),
    database: "shop",
    username: "postgres",
    password: "postgres",
  },
  mysql: {
    type: "mysql",
    host: process.env.TEST_MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.TEST_MYSQL_PORT || 3307),
    database: "shop",
    username: "root",
    password: "mysql",
  },
};

// Sample MongoDB (a database users connect to - not Quereo's own MongoDB).
// Kept apart from SAMPLE_DATABASES because its queries are JSON commands, not SQL.
const SAMPLE_MONGO = {
  type: "mongodb",
  host: process.env.TEST_MONGO_HOST || "127.0.0.1",
  port: Number(process.env.TEST_MONGO_PORT || 27018),
  database: "shop",
  username: "mongo",
  password: "mongo",
};

let mongod;

// Starts an in-memory MongoDB for Quereo's own data and returns the Express app
const startTestApp = async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: "querylens_test" });
  const { default: app } = await import("../src/app.js");
  return app;
};

const stopTestApp = async () => {
  const { closeAllAdapters } = await import("../src/adapters/index.js");
  await closeAllAdapters();
  await mongoose.disconnect();
  await mongod?.stop();
};

// Registers + logs in a fresh user. Returns a helper that sends authed requests:
//   const api = await createUser(app); await api.get("/api/connections")
const createUser = async (app, email = `user${crypto.randomInt(1e9)}@test.dev`) => {
  const password = "correct-horse-battery";
  await request(app).post("/api/users/register").send({ fullName: "Test User", email, password }).expect(201);
  const login = await request(app).post("/api/users/login").send({ email, password }).expect(200);
  const token = login.body.data.accessToken;

  const withAuth = (method) => (url) => request(app)[method](url).set("Authorization", `Bearer ${token}`);

  return {
    email,
    password,
    token,
    get: withAuth("get"),
    post: withAuth("post"),
    patch: withAuth("patch"),
    delete: withAuth("delete"),
  };
};

export { SAMPLE_DATABASES, SAMPLE_MONGO, startTestApp, stopTestApp, createUser };
