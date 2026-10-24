#!/usr/bin/env node
// Collects the production secrets into apps/api/.prod.vars (gitignored, mode 600).
//
//   pnpm prod:env           ask for each value (Enter keeps the current one)
//   pnpm prod:env --check   only validate what's already saved
//
// Nothing is uploaded anywhere. The deploy reads this file. Keys are checked against
// their own service only (Postgres, Anthropic, Resend), never sent anywhere else.

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(root, "apps/api/.prod.vars");
const CHECK_ONLY = process.argv.includes("--check");

const c = (n) => (s) => (stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = c(1);
const dim = c(2);
const red = c(31);
const green = c(32);
const yellow = c(33);

/** @typedef {{ key: string, label: string, help: string, required?: boolean, secret?: boolean,
 *   generate?: () => string, validate?: (v: string) => string | null,
 *   verify?: (v: string, all: Record<string, string>) => Promise<string> }} Field */

/** @type {Field[]} */
const FIELDS = [
  {
    key: "DATABASE_URL",
    label: "Postgres connection string",
    help: "Any Postgres 15+ that Cloudflare Hyperdrive can reach (Neon, Supabase, Azure, ...).\nUse the direct (non-pooled) URL, e.g. postgres://user:pass@host:5432/db?sslmode=require",
    required: true,
    secret: true,
    validate: (v) => {
      let u;
      try {
        u = new URL(v);
      } catch {
        return "That isn't a URL.";
      }
      if (!["postgres:", "postgresql:"].includes(u.protocol))
        return "It must start with postgres://";
      if (!u.username || !u.password) return "It needs a user and a password.";
      if (["localhost", "127.0.0.1", "::1"].includes(u.hostname))
        return "That's a local database; production needs one on the internet.";
      return null;
    },
    verify: verifyDatabase,
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API key (Claude)",
    help: "console.anthropic.com → API keys. Billing must be set up. Starts with sk-ant-",
    required: true,
    secret: true,
    validate: (v) => (v.startsWith("sk-ant-") ? null : "Anthropic keys start with sk-ant-"),
    verify: async (v) => {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": v, "anthropic-version": "2023-06-01" },
      });
      if (res.status === 401) throw new Error("Anthropic rejected this key (401).");
      if (!res.ok) throw new Error(`Anthropic answered ${res.status}.`);
      return "key accepted";
    },
  },
  {
    key: "RESEND_API_KEY",
    label: "Resend API key (emails)",
    help: "resend.com → API keys. Add the domain hwrk.help in Resend first. Starts with re_",
    required: true,
    secret: true,
    validate: (v) => (v.startsWith("re_") ? null : "Resend keys start with re_"),
    verify: async (v) => {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { authorization: `Bearer ${v}` },
      });
      if (res.status === 401 || res.status === 403)
        throw new Error("Resend rejected this key. Use a key with full access.");
      if (!res.ok) throw new Error(`Resend answered ${res.status}.`);
      const { data = [] } = await res.json();
      const d = data.find((x) => x.name === "hwrk.help");
      if (!d) return yellow("key works, but hwrk.help isn't added in Resend yet");
      return d.status === "verified"
        ? "key works, hwrk.help verified"
        : yellow(`key works, hwrk.help is "${d.status}" (finish DNS in Resend)`);
    },
  },
  {
    key: "GOOGLE_CLIENT_ID",
    label: "Google OAuth client id (optional)",
    help: "Google Cloud → APIs & Services → Credentials → OAuth client (Web).\nRedirect URI: https://hwrk.help/api/auth/callback/google. Skip to hide the Google button.",
    validate: (v) =>
      v.endsWith(".apps.googleusercontent.com")
        ? null
        : "Client ids end with .apps.googleusercontent.com",
  },
  {
    key: "GOOGLE_CLIENT_SECRET",
    label: "Google OAuth client secret (optional)",
    help: "From the same OAuth client. Needed only if you set the client id.",
    secret: true,
  },
  {
    key: "DO_HOMEWORK_EMAILS",
    label: "Do my homework: allowed accounts (optional)",
    help: 'Comma-separated emails that see the owner-only "Do my homework" feature. Skip to keep it off.',
    validate: (v) =>
      v.split(",").every((e) => /^[^@\s]+@[^@\s]+$/.test(e.trim()))
        ? null
        : "Use emails separated by commas.",
  },
  {
    key: "AZURE_SPEECH_KEY",
    label: "Azure Speech key (optional)",
    help: "Only if you prefer Azure voices for videos. Skip to use Workers AI (default).",
    secret: true,
  },
  {
    key: "AZURE_SPEECH_REGION",
    label: "Azure Speech region (optional)",
    help: "e.g. eastus. Needed only with the Azure Speech key.",
    validate: (v) => (/^[a-z0-9]+$/.test(v) ? null : "Regions look like eastus or westeurope."),
  },
  {
    key: "BETTER_AUTH_SECRET",
    label: "Session signing secret",
    help: "Generated for you. Changing it later signs everyone out.",
    required: true,
    secret: true,
    generate: () => randomBytes(32).toString("base64"),
  },
  {
    key: "CANVAS_TOKEN_KEY",
    label: "Canvas token encryption key",
    help: "Generated for you (32 bytes, base64). Never change it after launch: stored Canvas tokens become unreadable.",
    required: true,
    secret: true,
    generate: () => randomBytes(32).toString("base64"),
    validate: (v) =>
      Buffer.from(v, "base64").length === 32 ? null : "It must be 32 bytes, base64 encoded.",
  },
];

// ---------------------------------------------------------------------------

function load() {
  if (!existsSync(FILE)) return {};
  const out = {};
  for (const line of readFileSync(FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function save(values) {
  const lines = [
    "# Production secrets for `wrangler deploy --env production`. Written by scripts/prod-env.mjs.",
    "# Gitignored. Don't commit, don't paste anywhere.",
    ...FIELDS.filter((f) => values[f.key]).map((f) => `${f.key}=${values[f.key]}`),
    "",
  ];
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, lines.join("\n"), { mode: 0o600 });
  renameSync(tmp, FILE);
  chmodSync(FILE, 0o600);
}

const mask = (f, v) => {
  if (!v) return dim("not set");
  if (!f.secret) return v;
  return `${"•".repeat(6)}${v.slice(-4)}`;
};

async function verifyDatabase(url) {
  const require = createRequire(join(root, "packages/db/package.json"));
  const postgres = require("postgres");
  const sql = postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 1, onnotice: () => {} });
  try {
    const [row] = await sql`select current_setting('server_version_num')::int as v,
      pg_size_pretty(pg_database_size(current_database())) as size`;
    if (row.v < 150000)
      throw new Error(`Postgres ${Math.floor(row.v / 10000)} is too old; use 15+.`);
    return `connected (Postgres ${Math.floor(row.v / 10000)}, ${row.size} used)`;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Reads a line; with `hidden`, echoes nothing (for keys and passwords). */
function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    stdout.write(question);
    let buf = "";
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        } else if (ch === "\r" || ch === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode(wasRaw);
          stdin.pause();
          stdout.write("\n");
          resolve(buf.trim());
          return;
        } else if (ch === "\u007f" || ch === "\b") {
          if (buf.length) {
            buf = buf.slice(0, -1);
            if (!hidden) stdout.write("\b \b");
          }
        } else if (ch >= " ") {
          buf += ch;
          stdout.write(hidden ? "" : ch);
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function runVerify(f, v, values) {
  if (!f.verify) return true;
  stdout.write(dim("  checking… "));
  try {
    const msg = await f.verify(v, values);
    stdout.write(`\r  ${green("✓")} ${msg}\n`);
    return true;
  } catch (e) {
    stdout.write(`\r  ${red("✗")} ${e instanceof Error ? e.message : String(e)}\n`);
    return false;
  }
}

async function main() {
  const values = load();

  if (CHECK_ONLY) {
    let ok = true;
    for (const f of FIELDS) {
      const v = values[f.key];
      if (!v) {
        if (f.required) ok = false;
        console.log(
          `${f.required ? red("✗") : dim("–")} ${f.key}: ${f.required ? "missing" : dim("not set")}`,
        );
        continue;
      }
      const err = f.validate?.(v);
      console.log(
        `${err ? red("✗") : green("✓")} ${f.key}: ${mask(f, v)}${err ? ` ${red(err)}` : ""}`,
      );
      if (err || !(await runVerify(f, v, values))) ok = false;
    }
    process.exit(ok ? 0 : 1);
  }

  if (!stdin.isTTY) {
    console.error("Run this in a terminal (it asks questions). Use --check to only validate.");
    process.exit(1);
  }

  console.log(bold("\nTalvra production secrets → apps/api/.prod.vars"));
  console.log(
    dim(
      "Typing is hidden for secrets. Enter keeps the current value. Type - to clear an optional one.\n",
    ),
  );

  for (const f of FIELDS) {
    const current = values[f.key];
    console.log(`${bold(f.label)} ${dim(`(${f.key})`)}  ${mask(f, current)}`);
    console.log(dim(`  ${f.help.replaceAll("\n", "\n  ")}`));

    if (f.generate) {
      if (current) {
        console.log(`  ${green("✓")} kept the existing value\n`);
      } else {
        values[f.key] = f.generate();
        console.log(`  ${green("✓")} generated\n`);
      }
      continue;
    }

    if (f.key === "GOOGLE_CLIENT_SECRET" && !values.GOOGLE_CLIENT_ID) {
      delete values[f.key];
      console.log(dim("  skipped (no client id)\n"));
      continue;
    }
    if (f.key === "AZURE_SPEECH_REGION" && !values.AZURE_SPEECH_KEY) {
      delete values[f.key];
      console.log(dim("  skipped (no Azure Speech key)\n"));
      continue;
    }

    for (;;) {
      const prompt = current
        ? "  New value (Enter to keep): "
        : f.required
          ? "  Value: "
          : "  Value (Enter to skip): ";
      const input = await ask(prompt, { hidden: !!f.secret });
      if (!input) {
        if (current || !f.required) break;
        console.log(red("  This one is required."));
        continue;
      }
      if (input === "-" && !f.required) {
        delete values[f.key];
        console.log(dim("  cleared"));
        break;
      }
      const err = f.validate?.(input);
      if (err) {
        console.log(red(`  ${err}`));
        continue;
      }
      if (!(await runVerify(f, input, values))) {
        const again = await ask("  Save it anyway? [y/N] ");
        if (again.toLowerCase() !== "y") continue;
      }
      values[f.key] = input;
      break;
    }
    save(values); // after every answer, so Ctrl-C never loses what's done
    console.log("");
  }

  save(values);
  console.log(bold("Saved apps/api/.prod.vars") + dim(" (mode 600, gitignored)\n"));
  for (const f of FIELDS) {
    const v = values[f.key];
    console.log(
      `  ${v ? green("✓") : f.required ? red("✗") : dim("–")} ${f.key.padEnd(22)} ${mask(f, v)}`,
    );
  }
  const missing = FIELDS.filter((f) => f.required && !values[f.key]);
  console.log(
    missing.length
      ? red(`\nStill missing: ${missing.map((f) => f.key).join(", ")}. Run pnpm prod:env again.`)
      : green("\nAll set. Tell Claude it's ready to deploy."),
  );
}

main().catch((e) => {
  console.error(red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
