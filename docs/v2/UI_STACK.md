# UI stack (v2)

Decided before session 2. Everything here is free, and all of it installs
through the shadcn CLI, so the code lives in `apps/web/src/components` and
reads the same design tokens (`apps/web/src/styles/app.css`).

## Picks

| Layer | Library | Used for |
| --- | --- | --- |
| Primitives | **Base UI** (`@base-ui/react`) | Accessible behavior for dialogs, menus, popovers, tooltips, tabs, selects. shadcn's default base. |
| Components | **shadcn/ui** (core + official blocks) | Buttons, forms, cards, sidebar shell, ⌘K command menu, charts, calendar |
| Extended components | **Origin UI / coss ui** | Steppers, timelines, file upload, rich inputs, event calendar |
| Complex widgets | **Kibo UI** | Kanban (homework plan), calendar views, dropzone |
| Tables | **Dice UI** data table (TanStack Table) | Files, assignments, search results |
| AI chat | **Vercel AI Elements** | Ask: streamed messages, citations/sources, prompt input |
| Motion (sparingly) | **Magic UI** free tier, **Animate UI** | Number tickers, animated tabs. Must respect `prefers-reduced-motion`. |
| Toasts | **Sonner** | Feedback + "Undo" on destructive actions |
| Icons | **lucide-react** | Everywhere |
| Free Arc UI pieces | uiarc.dev free components | Fine to mix in; same tokens |

Skipped: Arc UI Pro (not purchased), Aceternity (landing-page flash, best parts paid),
Tremor (second styling system; shadcn charts cover Today).

## Adding components

```bash
cd apps/web
npx shadcn@latest add button dialog sidebar command   # core
npx shadcn@latest add @kibo-ui/kanban                 # namespaced registries
```

Namespaced registries resolve through shadcn's registry directory. If one
doesn't, add its URL under `registries` in `components.json`. Verify each
library's license on its own site before the first install.

The shadcn MCP server is configured in `.mcp.json`, so Claude Code can browse
and install from these registries instead of guessing props.

## Notes

- `components.json` uses `"style": "base-nova"` (shadcn on Base UI). If the CLI
  rejects it, run `npx shadcn@latest init` and pick Base UI; it rewrites the file.
- Components written in session 1 (`button`, `card`, `badge`, `skeleton`,
  `tooltip`) were hand-written because the registry hosts were unreachable
  from the build container. Session 2 can replace them with `shadcn add`.
