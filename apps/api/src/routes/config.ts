import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { PublicConfig } from "@talvra/contracts";
import { type AppEnv, allowedDomains } from "../env.js";

const route = createRoute({
  method: "get",
  path: "/config",
  tags: ["system"],
  summary: "Public settings the sign-in screen needs",
  responses: {
    200: { description: "Config", content: { "application/json": { schema: PublicConfig } } },
  },
});

export const configRoutes = new OpenAPIHono<AppEnv>().openapi(route, (c) =>
  c.json(
    {
      googleEnabled: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
      allowedEmailDomains: allowedDomains(c.env),
    },
    200,
  ),
);
