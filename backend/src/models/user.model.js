import mongoose, { Schema } from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const SALT_ROUNDS = 10;

const userSchema = new Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // select: false keeps the hash out of every query unless asked for explicitly.
    // Accounts created with Google have no password until they set one.
    password: {
      type: String,
      required: function () {
        return !this.googleId;
      },
      select: false,
    },
    // Google's stable account id ("sub"), set when someone signs in with Google
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    avatarUrl: {
      type: String,
    },
  },
  { timestamps: true }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
});

userSchema.methods.isPasswordCorrect = function (password) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(password, this.password);
};

userSchema.methods.generateAccessToken = function () {
  return jwt.sign({ _id: this._id }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "1d",
  });
};

// Never send Google's id to the browser
userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.googleId;
    return ret;
  },
});

export const User = mongoose.model("User", userSchema);
