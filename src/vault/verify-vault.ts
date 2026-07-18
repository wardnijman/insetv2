// Test van de credential-vault (R4.4): plaintext mag niet at rest staan, de round-trip
// moet kloppen, een verkeerde master-key moet fail-closed zijn, en elk gebruik wordt
// geaudit. Gebruikt een EFEMERE test-KEK zodat het overal draait (ook in CI).

import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { putCredential, getCredential } from "./vault.ts";

process.env.INSET_MASTER_KEY = randomBytes(32).toString("base64"); // test-key, geen echte secret

const portal = "verify-demo";
const secret = { user: "demo@example.com", pass: "s3cr3t-plaintext-xyz" };

let fail = 0;
function check(name: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) fail++;
}

putCredential(portal, secret);

// 1. de opgeslagen blob bevat de plaintext NIET
const raw = readFileSync(`.vault/${portal}.json`, "utf8");
check("plaintext staat niet in de opgeslagen blob", !raw.includes("s3cr3t-plaintext-xyz") && !raw.includes("demo@example.com"));

// 2. round-trip geeft het origineel terug
const got = getCredential(portal);
check("round-trip geeft het origineel terug", got.user === secret.user && got.pass === secret.pass);

// 3. verkeerde master-key -> decrypt faalt (fail closed)
const goodKek = process.env.INSET_MASTER_KEY;
process.env.INSET_MASTER_KEY = randomBytes(32).toString("base64");
let threw = false;
try { getCredential(portal); } catch { threw = true; }
check("verkeerde master-key -> decrypt faalt", threw);
process.env.INSET_MASTER_KEY = goodKek;

// 4. audit-log logt elk gebruik
const audit = readFileSync(".vault/audit.log", "utf8");
check("audit-log logt put én get", audit.includes(`put ${portal}`) && audit.includes(`get ${portal}`));

rmSync(`.vault/${portal}.json`, { force: true }); // testblob opruimen (audit blijft)

console.log(fail ? `\nFAIL — ${fail} check(s) fout` : "\nOK — vault: envelope-encryptie, geen plaintext at rest, fail-closed op verkeerde key, audit-log");
process.exit(fail ? 1 : 0);
