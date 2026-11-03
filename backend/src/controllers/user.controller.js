import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { isBlank } from "../utils/validate.js";
import { User } from "../models/user.model.js";
import { Connection } from "../models/connection.model.js";
import { SavedQuery } from "../models/savedQuery.model.js";
import { QueryHistory } from "../models/queryHistory.model.js";
import { Monitor } from "../models/monitor.model.js";
import { MonitorRun } from "../models/monitorRun.model.js";
import { Incident } from "../models/incident.model.js";
import { SchemaSnapshot } from "../models/schemaSnapshot.model.js";
import { getAdapter } from "../adapters/index.js";
import { googleClientId, verifyGoogleAccessToken } from "../utils/google.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
});

// What the browser may see: no hash, no Google id
const safeUser = (user) => {
  const { password: _, googleId: __, ...rest } = user.toObject();
  return rest;
};

const signIn = (res, user, created) =>
  res
    .status(created ? 201 : 200)
    .cookie("accessToken", user.generateAccessToken(), cookieOptions())
    .json(new ApiResponse(created ? 201 : 200, { user: safeUser(user), created }, created ? "Account created with Google" : "Logged in with Google"));

const registerUser = asyncHandler(async (req, res) => {
  const { fullName, email, password } = req.body || {};

  if ([fullName, email, password].some(isBlank)) {
    throw new ApiError(400, "Full name, email and password are required");
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new ApiError(400, "Please enter a valid email address");
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  if (await User.exists({ email: normalizedEmail })) {
    throw new ApiError(409, "An account with this email already exists");
  }

  const user = await User.create({ fullName, email: normalizedEmail, password });

  return res.status(201).json(new ApiResponse(201, safeUser(user), "Account created"));
});

const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};

  if (isBlank(email) || isBlank(password)) {
    throw new ApiError(400, "Email and password are required");
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+password");

  // Same message for unknown email and wrong password, so attackers can't
  // find out which emails have accounts
  if (!user || !(await user.isPasswordCorrect(password))) {
    throw new ApiError(401, "Invalid email or password");
  }

  const accessToken = user.generateAccessToken();

  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions())
    .json(new ApiResponse(200, { user: safeUser(user), accessToken }, "Logged in"));
});

// Which sign-in methods this server offers (the Google client id is public)
const getAuthConfig = asyncHandler(async (req, res) => {
  return res.status(200).json(new ApiResponse(200, { googleClientId: googleClientId() }, "Auth config"));
});

// Finds the account for a verified Google profile: by Google id, then by
// email (linking Google to an existing password account), else creates one
const findOrCreateGoogleUser = async ({ googleId, email, fullName, avatarUrl }) => {
  const byGoogle = await User.findOne({ googleId });
  if (byGoogle) return { user: byGoogle, created: false };

  const byEmail = await User.findOne({ email });
  if (byEmail) {
    byEmail.googleId = googleId;
    if (!byEmail.avatarUrl && avatarUrl) byEmail.avatarUrl = avatarUrl;
    await byEmail.save();
    return { user: byEmail, created: false };
  }

  const user = await User.create({ fullName: fullName.slice(0, 100), email, googleId, avatarUrl });
  return { user, created: true };
};

const googleAuth = asyncHandler(async (req, res) => {
  if (!googleClientId()) {
    throw new ApiError(503, "Google sign-in isn't set up on this server");
  }
  const { accessToken } = req.body || {};
  if (isBlank(accessToken)) {
    throw new ApiError(400, "Google access token is required");
  }

  const profile = await verifyGoogleAccessToken(accessToken).catch(() => null);
  if (!profile) {
    throw new ApiError(401, "Google couldn't confirm that sign-in. Please try again.");
  }

  const { user, created } = await findOrCreateGoogleUser(profile);
  return signIn(res, user, created);
});

// Work done per day for the settings heatmap: query runs (with how many were
// flagged or failed) bucketed in the user's own timezone, plus runs per hour
// of day. History is kept 90 days, so older days read as empty.
const ACTIVITY_DAYS = 182;
const validTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const getActivity = asyncHandler(async (req, res) => {
  const timezone = typeof req.query.tz === "string" && validTimeZone(req.query.tz) ? req.query.tz : "UTC";
  const since = new Date(Date.now() - ACTIVITY_DAYS * 86_400_000);
  const match = { user: req.user._id, createdAt: { $gte: since } };

  const [days, hours, monitors, saved, snapshots] = await Promise.all([
    QueryHistory.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } },
          runs: { $sum: 1 },
          flagged: { $sum: { $cond: [{ $in: ["$verdict", ["WARN", "SLOW"]] }, 1, 0] } },
          errors: { $sum: { $cond: [{ $eq: ["$status", "error"] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    QueryHistory.aggregate([
      { $match: match },
      { $group: { _id: { $hour: { date: "$createdAt", timezone } }, runs: { $sum: 1 } } },
    ]),
    Monitor.countDocuments({ user: req.user._id }),
    SavedQuery.countDocuments({ user: req.user._id }),
    SchemaSnapshot.countDocuments({ user: req.user._id }),
  ]);

  const byHour = Array(24).fill(0);
  hours.forEach((h) => (byHour[h._id] = h.runs));

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        timezone,
        days: days.map((d) => ({ date: d._id, runs: d.runs, flagged: d.flagged, errors: d.errors })),
        hours: byHour,
        totals: { monitors, savedQueries: saved, snapshots },
      },
      "Activity"
    )
  );
});

// Deletes the account and everything it owns. The email must be typed back
// as confirmation, so a stray request can't wipe an account.
const deleteAccount = asyncHandler(async (req, res) => {
  const { confirm } = req.body || {};
  if (isBlank(confirm) || confirm.trim().toLowerCase() !== req.user.email) {
    throw new ApiError(400, "Type your email address to confirm");
  }

  const userId = req.user._id;
  const connections = await Connection.find({ user: userId }).select("_id type");
  await Promise.all(connections.map((c) => getAdapter(c.type).close(c._id).catch(() => {})));

  const monitorIds = await Monitor.find({ user: userId }).distinct("_id");
  const [history, connectionsDeleted, monitorsDeleted] = await Promise.all([
    QueryHistory.deleteMany({ user: userId }),
    Connection.deleteMany({ user: userId }),
    Monitor.deleteMany({ user: userId }),
    SavedQuery.deleteMany({ user: userId }),
    MonitorRun.deleteMany({ monitor: { $in: monitorIds } }),
    Incident.deleteMany({ user: userId }),
    SchemaSnapshot.deleteMany({ user: userId }),
  ]);
  await User.deleteOne({ _id: userId });

  return res
    .status(200)
    .clearCookie("accessToken", cookieOptions())
    .json(
      new ApiResponse(
        200,
        { connections: connectionsDeleted.deletedCount, monitors: monitorsDeleted.deletedCount, history: history.deletedCount },
        "Account deleted"
      )
    );
});

const getCurrentUser = asyncHandler(async (req, res) => {
  return res.status(200).json(new ApiResponse(200, req.user, "Current user"));
});

const logoutUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .clearCookie("accessToken", cookieOptions())
    .json(new ApiResponse(200, {}, "Logged out"));
});

export { registerUser, loginUser, getCurrentUser, logoutUser, getAuthConfig, googleAuth, deleteAccount, findOrCreateGoogleUser, getActivity };
