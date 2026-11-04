// Runs the API with a temporary in-memory MongoDB for Quereo's own data,
// so the app can be tried without Atlas. Everything is lost when it stops.
//
//   npm run dev:local     then open http://localhost:8000
import path from "path";
import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// .env and the downloaded MongoDB binary are found relative to the backend
// folder, whatever folder this script was started from
process.chdir(backendDir);
process.env.MONGOMS_DOWNLOAD_DIR ??= path.join(backendDir, "node_modules", ".cache", "mongodb-memory-server");

const { MongoMemoryServer } = await import("mongodb-memory-server");
const mongod = await MongoMemoryServer.create();

// Set before server.js loads .env: dotenv never overrides existing variables
process.env.MONGODB_URI = mongod.getUri();
process.env.PORT ??= "8000";

// Lets `npm run seed:demo` backdate demo history straight in this database
const uriFile = path.join(backendDir, "node_modules", ".cache", "quereo-dev-mongo-uri.txt");
mkdirSync(path.dirname(uriFile), { recursive: true });
writeFileSync(uriFile, mongod.getUri());

console.log("Using a temporary in-memory MongoDB (data is lost on exit)");
await import("../src/server.js");
