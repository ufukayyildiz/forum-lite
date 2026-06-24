/**
 * Local dev seed helper.
 * Runs the English demo seed SQL against local D1.
 * Usage: npm run seed:local
 */

import { execFileSync } from "node:child_process";

execFileSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "forum-db",
    "--local",
    "--config",
    "wrangler.local.jsonc",
    "--file",
    "scripts/seed.sql",
  ],
  { stdio: "inherit", cwd: process.cwd() },
);
