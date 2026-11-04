import mongoose from "mongoose";

const sendError = (res, statusCode, message, errors = []) =>
  res.status(statusCode).json({
    success: false,
    message,
    errors,
    data: null,
  });

const notFoundHandler = (req, res) =>
  sendError(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);

const errorHandler = (err, req, res, next) => {
  // Malformed JSON body
  if (err.type === "entity.parse.failed") {
    return sendError(res, 400, "Request body is not valid JSON");
  }

  if (err instanceof mongoose.Error.CastError) {
    return sendError(res, 400, `Invalid ${err.path}: ${err.value}`);
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const errors = Object.values(err.errors).map((e) => e.message);
    return sendError(res, 400, errors[0] || "Validation failed", errors);
  }

  // Duplicate key on a unique index
  if (err?.code === 11000) {
    const field = Object.keys(err.keyValue || {}).find((key) => key !== "user") || "value";
    return sendError(res, 409, `That ${field} is already taken`);
  }

  const statusCode = err.statusCode || 500;

  if (statusCode >= 500) {
    console.error(err);
  }

  return sendError(
    res,
    statusCode,
    statusCode >= 500 && process.env.NODE_ENV === "production"
      ? "Internal Server Error"
      : err.message || "Internal Server Error",
    err.errors || []
  );
};

export { errorHandler, notFoundHandler };
