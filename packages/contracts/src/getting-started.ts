import { z } from "zod";

/** The Today checklist: each step is done when the data shows it, not when it's ticked. */
export const GettingStarted = z.object({
  steps: z.object({
    canvas: z.boolean(),
    studyAid: z.boolean(),
    review: z.boolean(),
    ask: z.boolean(),
    assistant: z.boolean(),
  }),
  dismissed: z.boolean(),
});
export type GettingStarted = z.infer<typeof GettingStarted>;
