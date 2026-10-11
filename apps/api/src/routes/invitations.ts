import { Router } from "express";
import * as invitations from "../controllers/invitations.controller.js";

export const invitationsRouter = Router();

// Not under /orgs/:orgId: the invitee isn't a member yet, so the token identifies the org.
invitationsRouter.post("/accept", invitations.accept);
