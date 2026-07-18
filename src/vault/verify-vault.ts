// Test van de multi-tenant vault (R4.4): sleutel (tenant, portaal, credIndex),
// geen plaintext at rest, round-trip, fail-closed op verkeerde key, meerdere logins
// per (tenant, portaal), audit-log. Efemere test-KEK zodat het overal draait (CI).

import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { putCredential, getCredential, hasCredential } from "./vault.ts";

process.env.INSET_MASTER_KEY = randomBytes(32).toString("base64"); // test-key, geen echte secret

const tenant = "verify-demo";
const portal = "tff";
const secret = { user: "demo@example.com", pass: "s3cr3t-plaintext-xyz" };

let fail = 0;
function check(name: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) fail++;
}

putCredential(tenant, portal, secret);

const raw = readFileSync(`.vault/${tenant}/${portal}-0.json`, "utf8");
check("plaintext staat niet in de opgeslagen blob", !raw.includes("s3cr3t-plaintext-xyz") && !raw.includes("demo@example.com"));

const got = getCredential(tenant, portal);
check("round-trip geeft het origineel terug", got.user === secret.user && got.pass === secret.pass);

const goodKek = process.env.INSET_MASTER_KEY;
process.env.INSET_MASTER_KEY = randomBytes(32).toString("base64");
let threw = false;
try { getCredential(tenant, portal); } catch { threw = true; }
check("verkeerde master-key -> decrypt faalt", threw);
process.env.INSET_MASTER_KEY = goodKek;

// meerdere logins per (tenant, portaal) voor pooling
putCredential(tenant, portal, { user: "pool2@x", pass: "p2" }, 1);
check("meerdere logins per (tenant, portaal) (credIndex)", hasCredential(tenant, portal, 1) && getCredential(tenant, portal, 1).user === "pool2@x");

const audit = readFileSync(".vault/audit.log", "utf8");
check("audit-log logt (tenant/portaal#index)", audit.includes(`put ${tenant}/${portal}#0`) && audit.includes(`get ${tenant}/${portal}#0`));

rmSync(`.vault/${tenant}`, { recursive: true, force: true }); // tenant-map opruimen

console.log(fail ? `\nFAIL — ${fail} check(s) fout` : "\nOK — multi-tenant vault: (tenant,portaal,credIndex), geen plaintext at rest, fail-closed, pooling, audit");
process.exit(fail ? 1 : 0);
