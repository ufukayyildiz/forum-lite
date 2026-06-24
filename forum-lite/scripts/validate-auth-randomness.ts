import { readFile } from "node:fs/promises";
import { generatePublicId, generateShortId, secureRandomInt } from "../src/worker/lib/auth.ts";
import { generateTemporaryPassword } from "../src/worker/routes/auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

for (let i = 0; i < 500; i++) {
  const password = generateTemporaryPassword();
  assert(/^\d{6}[A-Z][a-z]$/.test(password), `invalid temporary password format: ${password}`);

  const userId = Number(generatePublicId());
  assert(Number.isInteger(userId) && userId >= 100_000 && userId <= 999_999, `invalid public id: ${userId}`);

  const shortId = Number(generateShortId());
  assert(Number.isInteger(shortId) && shortId >= 1_000 && shortId <= 9_999, `invalid short id: ${shortId}`);

  const smallRandom = secureRandomInt(10);
  assert(Number.isInteger(smallRandom) && smallRandom >= 0 && smallRandom < 10, `invalid secureRandomInt value: ${smallRandom}`);
}

const authRouteSource = await readFile(new URL("../src/worker/routes/auth.ts", import.meta.url), "utf8");
const authLibSource = await readFile(new URL("../src/worker/lib/auth.ts", import.meta.url), "utf8");
const emailLibSource = await readFile(new URL("../src/worker/lib/email.ts", import.meta.url), "utf8");
assert(!/Math\.random/.test(`${authRouteSource}\n${authLibSource}\n${emailLibSource}`), "worker auth/email code must not use Math.random()");

console.log("auth randomness validation passed");
