import { Router } from "express";
import {
  listHistory,
  clearHistory,
  listSavedQueries,
  createSavedQuery,
  updateSavedQuery,
  deleteSavedQuery,
} from "../controllers/query.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const historyRouter = Router();
historyRouter.use(verifyJWT);
historyRouter.route("/").get(listHistory).delete(clearHistory);

const savedQueryRouter = Router();
savedQueryRouter.use(verifyJWT);
savedQueryRouter.route("/").get(listSavedQueries).post(createSavedQuery);
savedQueryRouter.route("/:id").patch(updateSavedQuery).delete(deleteSavedQuery);

export { historyRouter, savedQueryRouter };
