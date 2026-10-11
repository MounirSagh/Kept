import type { User } from "@kept/db";
import type { Actor } from "@kept/shared";

export interface OrgActor extends Actor {
  orgId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      actor?: OrgActor;
    }
  }
}
