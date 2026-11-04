import { describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import express from "express";
import cors from "cors";
import { validateEnv, corsOriginOption } from "../src/config/env.js";

const VALID = {
  MONGODB_URI: "mongodb://localhost",
  ACCESS_TOKEN_SECRET: "x".repeat(40),
  ENCRYPTION_KEY: "a".repeat(64),
};

describe("startup config validation", () => {
  it("accepts a complete development config", () => {
    assert.doesNotThrow(() => validateEnv(VALID));
  });

  it("lists every problem at once", () => {
    assert.throws(
      () => validateEnv({ ENCRYPTION_KEY: "short" }),
      (error) => /MONGODB_URI/.test(error.message) && /ACCESS_TOKEN_SECRET/.test(error.message) && /ENCRYPTION_KEY/.test(error.message)
    );
  });

  it("is stricter in production", () => {
    const production = { ...VALID, NODE_ENV: "production", CORS_ORIGIN: "https://app.example.com" };
    assert.doesNotThrow(() => validateEnv(production));

    assert.throws(() => validateEnv({ ...production, CORS_ORIGIN: "*" }), /CORS_ORIGIN/);
    assert.throws(() => validateEnv({ ...production, CORS_ORIGIN: "" }), /CORS_ORIGIN/);
    assert.throws(() => validateEnv({ ...production, ACCESS_TOKEN_SECRET: "change-me" }), /ACCESS_TOKEN_SECRET/);
  });
});

describe("CORS", () => {
  const appWith = (env) => {
    const app = express();
    app.use(cors({ origin: corsOriginOption(env), credentials: true }));
    app.get("/", (req, res) => res.send("ok"));
    return app;
  };
  const allowedOrigin = async (env, origin) =>
    (await request(appWith(env)).get("/").set("Origin", origin)).headers["access-control-allow-origin"];

  it("never lets an unknown website call the API with the user's cookies", async () => {
    assert.equal(await allowedOrigin({}, "https://evil.example"), undefined);
    assert.equal(await allowedOrigin({ CORS_ORIGIN: "*" }, "https://evil.example"), undefined);
    assert.equal(await allowedOrigin({ CORS_ORIGIN: "https://app.example.com" }, "https://evil.example"), undefined);
  });

  it("allows the configured frontend, and localhost in development", async () => {
    assert.equal(await allowedOrigin({ CORS_ORIGIN: "https://app.example.com/" }, "https://app.example.com"), "https://app.example.com");
    assert.equal(await allowedOrigin({}, "http://localhost:5173"), "http://localhost:5173");
  });
});
