import { Router } from "express";
import { can } from "@kept/shared";
import * as accounts from "../controllers/accounts.controller.js";
import * as actions from "../controllers/actions.controller.js";
import * as commitments from "../controllers/commitments.controller.js";
import * as connections from "../controllers/connections.controller.js";
import * as contacts from "../controllers/contacts.controller.js";
import * as flags from "../controllers/flags.controller.js";
import * as invitations from "../controllers/invitations.controller.js";
import * as members from "../controllers/members.controller.js";
import * as orgs from "../controllers/orgs.controller.js";
import * as routing from "../controllers/routing.controller.js";
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
orgsRouter.get("/:orgId", member, orgs.get);
orgsRouter.patch("/:orgId", orgManager, orgs.update);

orgsRouter.get("/:orgId/teams", member, teams.list);
orgsRouter.post("/:orgId/teams", teamManager, teams.create);
orgsRouter.post("/:orgId/teams/import", teamManager, teams.importRows);
orgsRouter.patch("/:orgId/teams/:teamId", teamManager, teams.rename);
orgsRouter.delete("/:orgId/teams/:teamId", teamManager, teams.remove);

orgsRouter.get("/:orgId/members", member, members.list);
orgsRouter.patch("/:orgId/members/:userId", member, members.update);
orgsRouter.delete("/:orgId/members/:userId", member, members.remove);

orgsRouter.get("/:orgId/invitations", invitationViewer, invitations.list);
orgsRouter.post("/:orgId/invitations", invitationViewer, invitations.create);
orgsRouter.post("/:orgId/invitations/import", invitationViewer, invitations.importRows);
orgsRouter.post("/:orgId/invitations/:invitationId/resend", invitationViewer, invitations.resend);
orgsRouter.post("/:orgId/invitations/:invitationId/link", invitationViewer, invitations.link);
orgsRouter.delete("/:orgId/invitations/:invitationId", invitationViewer, invitations.revoke);

orgsRouter.get("/:orgId/accounts", member, accounts.list);
// Paged, searchable, sortable table; registered before /:accountId so "page" isn't read as an id.
orgsRouter.get("/:orgId/accounts/page", member, accounts.listPage);
orgsRouter.get("/:orgId/accounts/:accountId", member, accounts.get);
orgsRouter.post("/:orgId/accounts", member, accounts.create);
orgsRouter.post("/:orgId/accounts/import", member, accounts.importRows);
orgsRouter.patch("/:orgId/accounts/:accountId", member, accounts.update);
orgsRouter.delete("/:orgId/accounts/:accountId", member, accounts.remove);

// The people at each client; who may change them is checked in the service.
orgsRouter.get("/:orgId/contacts", member, contacts.listPage);
orgsRouter.get("/:orgId/accounts/:accountId/contacts", member, contacts.list);
orgsRouter.post("/:orgId/accounts/:accountId/contacts", member, contacts.create);
orgsRouter.patch("/:orgId/contacts/:contactId", member, contacts.update);
orgsRouter.delete("/:orgId/contacts/:contactId", member, contacts.remove);

// Anyone who can see an account can track its commitments; checked in the service.
orgsRouter.get("/:orgId/commitments", member, commitments.list);
orgsRouter.post("/:orgId/commitments", member, commitments.create);
orgsRouter.post("/:orgId/commitments/import", member, commitments.importRows);
orgsRouter.patch("/:orgId/commitments/:commitmentId", member, commitments.update);
orgsRouter.delete("/:orgId/commitments/:commitmentId", member, commitments.remove);

// Flags and proposed actions follow account visibility; checked in the service.
orgsRouter.get("/:orgId/flags", member, flags.list);
orgsRouter.post("/:orgId/flags/:flagId/decision", member, flags.decide);
orgsRouter.get("/:orgId/actions", member, actions.list);
orgsRouter.post("/:orgId/actions/:actionId/decision", member, actions.decide);

orgsRouter.get("/:orgId/routing", member, routing.get);
orgsRouter.put("/:orgId/routing/:connectionId/:containerId", member, routing.setMapping);

// Who may connect or manage depends on the provider and owner; checked in the service.
orgsRouter.get("/:orgId/connections", member, connections.list);
orgsRouter.post("/:orgId/connections/:provider/authorize", member, connections.authorize);
orgsRouter.post("/:orgId/connections/:connectionId/sync", member, connections.sync);
orgsRouter.delete("/:orgId/connections/:connectionId", member, connections.remove);

orgsRouter.use("/:orgId/agent-runs", member, agentRunsRouter);
