import { Router } from "express";
import { can } from "@kept/shared";
import * as accounts from "../controllers/accounts.controller.js";
import * as invitations from "../controllers/invitations.controller.js";
import * as members from "../controllers/members.controller.js";
import * as orgs from "../controllers/orgs.controller.js";
import * as teams from "../controllers/teams.controller.js";
import { requireOrgAccess } from "../middlewares/auth.js";
import { agentRunsRouter } from "./agent-runs.js";

export const orgsRouter = Router();

// Routes with a check reject outright; the rest depend on the target and are checked in the service.
const member = requireOrgAccess();
const orgManager = requireOrgAccess((a) => can(a, { action: "org.manage" }));
const teamManager = requireOrgAccess((a) => can(a, { action: "team.manage" }));
const invitationViewer = requireOrgAccess((a) => can(a, { action: "invitation.list" }));

orgsRouter.post("/", orgs.create);
orgsRouter.patch("/:orgId", orgManager, orgs.rename);

orgsRouter.get("/:orgId/teams", member, teams.list);
orgsRouter.post("/:orgId/teams", teamManager, teams.create);
orgsRouter.patch("/:orgId/teams/:teamId", teamManager, teams.rename);
orgsRouter.delete("/:orgId/teams/:teamId", teamManager, teams.remove);

orgsRouter.get("/:orgId/members", member, members.list);
orgsRouter.patch("/:orgId/members/:userId", member, members.update);
orgsRouter.delete("/:orgId/members/:userId", member, members.remove);

orgsRouter.get("/:orgId/invitations", invitationViewer, invitations.list);
orgsRouter.post("/:orgId/invitations", invitationViewer, invitations.create);
orgsRouter.delete("/:orgId/invitations/:invitationId", invitationViewer, invitations.revoke);

orgsRouter.get("/:orgId/accounts", member, accounts.list);
orgsRouter.get("/:orgId/accounts/:accountId", member, accounts.get);

orgsRouter.use("/:orgId/agent-runs", member, agentRunsRouter);
