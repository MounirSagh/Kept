import { verifyWebhook } from "@clerk/express/webhooks";
import type { Request, Response } from "express";
import { env } from "../env.js";
import { deleteUserByClerkId, profileFromWebhook, upsertUser } from "../services/users.service.js";

export async function clerk(req: Request, res: Response) {
  if (!env.CLERK_WEBHOOK_SIGNING_SECRET) {
    res.status(503).json({ error: "Webhook signing secret not configured" });
    return;
  }

  let event;
  try {
    event = await verifyWebhook(req, { signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET });
  } catch {
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const profile = profileFromWebhook(event.data);
      if (profile) await upsertUser(profile);
      break;
    }
    case "user.deleted":
      if (event.data.id) await deleteUserByClerkId(event.data.id);
      break;
  }
  res.status(204).end();
}
