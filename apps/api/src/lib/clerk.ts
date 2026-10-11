import { createClerkClient } from "@clerk/backend";
import { env } from "../env.js";

export const clerk = createClerkClient({
  secretKey: env.CLERK_SECRET_KEY,
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
});
