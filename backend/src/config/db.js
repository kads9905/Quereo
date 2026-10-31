import mongoose from "mongoose";

const DB_NAME = "querylens";

// Quereo's own data (users, connections, monitors...) lives in MongoDB.
// dbName is passed as an option so it works with any URI, including Atlas
// URIs that already carry query parameters.
const connectDB = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  const connection = await mongoose.connect(uri, { dbName: DB_NAME });
  console.log(`MongoDB connected: ${connection.connection.host}`);
};

export default connectDB;
