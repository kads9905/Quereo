// Checks the server's configuration once, at startup. A missing or broken
// setting stops the server with a clear message, instead of surfacing later
// as a confusing 500 error (e.g. the first time someone saves a connection).
const validateEnv = (env = process.env) => {
  const problems = [];
  const isProduction = env.NODE_ENV === "production";

  if (!env.MONGODB_URI) problems.push("MONGODB_URI is required (Quereo's own MongoDB)");

  if (!env.ACCESS_TOKEN_SECRET) {
    problems.push("ACCESS_TOKEN_SECRET is required");
  } else if (isProduction && (env.ACCESS_TOKEN_SECRET.length < 32 || env.ACCESS_TOKEN_SECRET === "change-me")) {
    problems.push("ACCESS_TOKEN_SECRET must be a random string of at least 32 characters in production");
  }

  if (!/^[0-9a-f]{64}$/i.test(env.ENCRYPTION_KEY || "")) {
    problems.push("ENCRYPTION_KEY must be 64 hex characters (generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")");
  }

  // With cookies, allowing every origin would let any website call the API as the logged-in user
  if (isProduction && (!env.CORS_ORIGIN || env.CORS_ORIGIN.trim() === "*")) {
    problems.push("CORS_ORIGIN must list your frontend URL(s) in production, e.g. https://quereo.vercel.app");
  }

  if (env.PORT && !/^\d+$/.test(env.PORT)) problems.push("PORT must be a number");

  if (problems.length) {
    throw new Error(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
  }
};

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Which websites may call the API with the user's cookies:
//   CORS_ORIGIN set:  exactly those origins (comma separated)
//   not set:          localhost only (development); production refuses to start, see above
const corsOriginOption = (env = process.env) => {
  const configured = env.CORS_ORIGIN?.trim();
  if (configured && configured !== "*") {
    const allowed = configured.split(",").map((origin) => origin.trim().replace(/\/$/, ""));
    return allowed;
  }
  return (origin, callback) => {
    // No Origin header = not a browser cross-site request (curl, server-to-server, same origin)
    callback(null, !origin || LOCALHOST_ORIGIN.test(origin));
  };
};

export { validateEnv, corsOriginOption };
