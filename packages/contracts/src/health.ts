import { z } from "zod";

export const Health = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  checks: z.record(z.string(), z.enum(["ok", "fail", "skipped"])),
});
export type Health = z.infer<typeof Health>;
