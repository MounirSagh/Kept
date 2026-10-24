import express from "express";
import { authenticate, requireUser } from "./middlewares/auth.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { healthRouter } from "./routes/health.js";
import { invitationsRouter } from "./routes/invitations.js";
import { oauthRouter } from "./routes/oauth.js";
import { meRouter } from "./routes/me.js";
import { orgsRouter } from "./routes/orgs.js";
import { webhooksRouter } from "./routes/webhooks.js";

export const app = express();

app.use("/api/webhooks", webhooksRouter);

app.use(express.json({ limit: "5mb" }));
app.use("/api/health", healthRouter);

app.use("/api", authenticate, requireUser);
app.use("/api/me", meRouter);
app.use("/api/orgs", orgsRouter);
app.use("/api/invitations", invitationsRouter);
app.use("/api/oauth", oauthRouter);

app.use(errorHandler);
