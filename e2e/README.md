# End-to-end tests

Full-stack Playwright tests: real browser, real Worker, Postgres, queues, R2 (local) and the
extract container. They also run axe (WCAG 2.2 AA, including color contrast) and fail on any CSP
violation. Not part of `pnpm check` (they need Docker and a running stack).

```bash
pnpm db:up && pnpm db:migrate
pnpm --filter @talvra/web build                         # the Worker serves apps/web/dist
pnpm --filter @talvra/api dev > /tmp/talvra-api.log 2>&1 &
pnpm --filter @talvra/e2e exec playwright install chromium   # once
E2E_API_LOG=/tmp/talvra-api.log pnpm e2e
```

Canvas isn't exercised (it needs a real token); the test marks the account as set up directly.
