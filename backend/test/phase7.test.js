import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { startTestApp, stopTestApp, createUser } from "./helpers.js";
import { User } from "../src/models/user.model.js";
import { QueryHistory } from "../src/models/queryHistory.model.js";
import { SavedQuery } from "../src/models/savedQuery.model.js";
import { findOrCreateGoogleUser } from "../src/controllers/user.controller.js";

let app;

before(async () => {
  app = await startTestApp();
});

after(stopTestApp);

describe("google sign-in", () => {
  it("reports no Google client id and refuses Google sign-in when it isn't set", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const config = await request(app).get("/api/users/auth-config").expect(200);
    assert.equal(config.body.data.googleClientId, null);

    await request(app).post("/api/users/google").send({ accessToken: "anything" }).expect(503);
  });

  it("rejects a missing token once Google is set up", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
    try {
      const config = await request(app).get("/api/users/auth-config").expect(200);
      assert.equal(config.body.data.googleClientId, "test-client.apps.googleusercontent.com");
      await request(app).post("/api/users/google").send({}).expect(400);
    } finally {
      delete process.env.GOOGLE_CLIENT_ID;
    }
  });

  it("creates a passwordless account, then finds it again by Google id", async () => {
    const profile = { googleId: "g-100", email: "gina@test.dev", fullName: "Gina Google", avatarUrl: "https://example.com/g.png" };
    const first = await findOrCreateGoogleUser(profile);
    assert.equal(first.created, true);
    assert.equal(first.user.email, "gina@test.dev");

    const again = await findOrCreateGoogleUser({ ...profile, email: "renamed@test.dev" });
    assert.equal(again.created, false);
    assert.equal(String(again.user._id), String(first.user._id));

    // no password, so password sign-in is refused rather than crashing
    await request(app).post("/api/users/login").send({ email: "gina@test.dev", password: "whatever-pass" }).expect(401);
  });

  it("links Google to an existing password account with the same email", async () => {
    const api = await createUser(app, "linda@test.dev");
    const { user, created } = await findOrCreateGoogleUser({ googleId: "g-200", email: "linda@test.dev", fullName: "Linda" });
    assert.equal(created, false);
    assert.equal(user.googleId, "g-200");

    // the password still works, and the Google id never reaches the browser
    await request(app).post("/api/users/login").send({ email: api.email, password: api.password }).expect(200);
    const me = await api.get("/api/users/me").expect(200);
    assert.equal(me.body.data.googleId, undefined);
  });
});

describe("deleting an account", () => {
  it("needs the email typed back as confirmation", async () => {
    const api = await createUser(app);
    await api.delete("/api/users/me").send({}).expect(400);
    await api.delete("/api/users/me").send({ confirm: "someone-else@test.dev" }).expect(400);
    await api.get("/api/users/me").expect(200);
  });

  it("removes the user and everything they own, and leaves other users alone", async () => {
    const api = await createUser(app);
    const other = await createUser(app);
    const userId = (await api.get("/api/users/me")).body.data._id;
    const otherId = (await other.get("/api/users/me")).body.data._id;
    const connection = new mongoose.Types.ObjectId();

    await QueryHistory.create({ user: userId, connection, sql: "SELECT 1", status: "ok" });
    await SavedQuery.create({ user: userId, connection, name: "mine", sql: "SELECT 1" });
    await QueryHistory.create({ user: otherId, connection, sql: "SELECT 2", status: "ok" });

    const res = await api.delete("/api/users/me").send({ confirm: api.email.toUpperCase() }).expect(200);
    assert.equal(res.body.data.history, 1);

    assert.equal(await User.exists({ _id: userId }), null);
    assert.equal(await QueryHistory.countDocuments({ user: userId }), 0);
    assert.equal(await SavedQuery.countDocuments({ user: userId }), 0);
    assert.equal(await QueryHistory.countDocuments({ user: otherId }), 1);

    // the old token no longer works
    await api.get("/api/users/me").expect(401);
  });
});

describe("activity", () => {
  it("counts runs per day in the user's timezone, with flagged and failed runs", async () => {
    const api = await createUser(app);
    const userId = (await api.get("/api/users/me")).body.data._id;
    const connection = new mongoose.Types.ObjectId();
    await QueryHistory.create([
      { user: userId, connection, sql: "SELECT 1", status: "ok", verdict: "PASS" },
      { user: userId, connection, sql: "SELECT 2", status: "ok", verdict: "SLOW" },
      { user: userId, connection, sql: "SELEC", status: "error" },
    ]);

    const res = await api.get("/api/users/me/activity?tz=Asia/Kolkata").expect(200);
    const { days, hours, timezone } = res.body.data;
    assert.equal(timezone, "Asia/Kolkata");
    assert.equal(days.length, 1);
    assert.deepEqual({ runs: days[0].runs, flagged: days[0].flagged, errors: days[0].errors }, { runs: 3, flagged: 1, errors: 1 });
    assert.equal(hours.length, 24);
    assert.equal(hours.reduce((a, b) => a + b, 0), 3);

    // an unknown timezone falls back to UTC instead of failing
    const fallback = await api.get("/api/users/me/activity?tz=Not/AZone").expect(200);
    assert.equal(fallback.body.data.timezone, "UTC");
  });
});
