import { ApiError } from "./ApiError.js";

const isBlank = (value) => typeof value !== "string" || value.trim() === "";

// Route params like /connections/:id must be positive integers
const parseId = (value, label = "id") => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, `Invalid ${label}`);
  }
  return id;
};

// Reads an optional integer from the body/query, clamped to [min, max]
const intInRange = (value, { min, max, fallback, label }) => {
  if (value === undefined || value === null || value === "") return fallback;

  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ApiError(400, `${label} must be a whole number between ${min} and ${max}`);
  }
  return number;
};

export { isBlank, parseId, intInRange };
