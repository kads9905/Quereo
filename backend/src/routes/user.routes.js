import { Router } from "express";
import { registerUser, loginUser, getCurrentUser, logoutUser, getAuthConfig, googleAuth, deleteAccount, getActivity } from "../controllers/user.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/register", registerUser);

router.post("/login", loginUser);

router.get("/auth-config", getAuthConfig);

router.post("/google", googleAuth);

router.get("/me", verifyJWT, getCurrentUser);

router.delete("/me", verifyJWT, deleteAccount);

router.get("/me/activity", verifyJWT, getActivity);

router.post("/logout", verifyJWT, logoutUser);

export default router;
