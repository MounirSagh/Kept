import { Router } from "express";
import * as me from "../controllers/me.controller.js";

export const meRouter = Router();

meRouter.get("/", me.get);
