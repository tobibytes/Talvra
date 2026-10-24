// Copies apps/api/src/ai/nbbuild.py into a TS module (the Worker uploads it to the sandbox).
// Run after editing nbbuild.py: node scripts/gen-nbbuild.mjs. A test checks they match.
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("apps/api/src/ai/nbbuild.py", "utf8");
if (src.includes("`") || src.includes("${")) throw new Error("nbbuild.py can't contain ` or ${");
writeFileSync(
  "apps/api/src/ai/nbbuild-source.ts",
  `// Generated from nbbuild.py by scripts/gen-nbbuild.mjs. Don't edit by hand.\nexport const NBBUILD_PY = String.raw\`${src}\`;\n`,
);
