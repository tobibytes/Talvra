import { z } from "zod";

export const Id = z.uuid();
export const Timestamp = z.iso.datetime({ offset: true });

/** Cursor pagination used by every list endpoint. */
export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
