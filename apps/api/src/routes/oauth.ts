import { Router } from "express";
import * as connections from "../controllers/connections.controller.js";

export const oauthRouter = Router();

// The provider redirects the browser to the web app's /oauth/callback page, which posts the
// code here with the user's normal session. The signed state names the org.
oauthRouter.post("/callback", connections.callback);
