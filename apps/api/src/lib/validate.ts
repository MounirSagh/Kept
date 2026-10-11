import type { z } from "zod";
import { HttpError } from "./http-error.js";

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, "Invalid request");
  return result.data;
}
