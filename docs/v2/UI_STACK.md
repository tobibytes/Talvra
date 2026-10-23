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

- `components.json` uses `"style": "base-nova"`: shadcn on Base UI. Confirmed against the registry.
- Origin UI is now **coss ui**, under the `@coss` namespace (`npx shadcn add @coss/<name>`).
- `apps/web/src/styles/app.css` must keep `@import "shadcn/tailwind.css"`. It defines
  the `data-open`, `data-horizontal`, `data-selected` and other variants the components use.
  Without it, tabs lay out sideways and every command palette item looks selected.
- **CLI quirk:** `shadcn add` (4.22.1) wrote `import { cn } from "cn"` and added a
  `cn` dependency. After adding components, run
  `grep -rl 'from "cn"' src | xargs sed -i 's#from "cn"#from "@/lib/utils"#'` and remove `cn`
  from `package.json`.
- `src/components/ui/**` is vendored: Biome formats it but doesn't lint it, so updates
  from upstream stay clean. Accessibility is checked at runtime by the axe tests in
  `src/app.test.tsx`.
- Talvra additions to vendored files are marked with a `Talvra` comment (currently
  the `success` and `warning` badge variants).

## App structure (session 2)

| Piece | File |
| --- | --- |
| Shell: sidebar (desktop, collapses to icons), 5-tab bottom bar (mobile), top bar | `src/components/app-shell.tsx` |
| Nav config shared by sidebar, tab bar and palette | `src/lib/nav.ts` |
| ⌘K / Ctrl+K command palette | `src/components/command-palette.tsx` |
| Light, dark and system themes (next-themes) | `src/components/theme.tsx` |
| Page header, empty, error (with request id) and loading states | `src/components/page.tsx` |
| Live API status in sidebar footer | `src/components/api-status.tsx` |
| Component gallery | `/gallery` (`src/routes/gallery.tsx`) |
