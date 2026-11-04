import crypto from "crypto";

// Saved database passwords are encrypted with AES-256-GCM.
// GCM also authenticates the data, so a tampered value fails to decrypt
// instead of silently producing garbage.
const ALGORITHM = "aes-256-gcm";

const getKey = () => {
  const hex = process.env.ENCRYPTION_KEY || "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
};

// Output format: iv.authTag.ciphertext, each base64
const encrypt = (plainText) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted].map((part) => part.toString("base64")).join(".");
};

const decrypt = (payload) => {
  const [iv, tag, encrypted] = payload.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
};

export { encrypt, decrypt };
