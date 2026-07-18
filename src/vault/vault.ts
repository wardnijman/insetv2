// Credential-vault (R4.4), multi-tenant. Sleutel = (tenant, portaal, credIndex):
// een klant (forwarder óf verlader) heeft één of meer logins per portaal. Envelope:
// per-cred DEK versleutelt de creds; de DEK zelf versleuteld met de master-key (KEK).
// Per-tenant map (.vault/<tenant>/) zodat per-tenant backup = de map kopiëren (R4.1).
// Elke get/put geaudit. Nul plaintext at rest — tegenhanger v1-doodzonde (§8).
//
// KEK uit process.env.INSET_MASTER_KEY (32 bytes base64) — prod: KMS, nooit uit de repo.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const VAULT_DIR = ".vault";
interface Enc { iv: string; tag: string; ct: string }

function kek(): Buffer {
  const b64 = process.env.INSET_MASTER_KEY;
  if (!b64) throw new Error("[vault] INSET_MASTER_KEY niet gezet (fail closed)");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("[vault] INSET_MASTER_KEY moet 32 bytes zijn (base64)");
  return key;
}

function encrypt(key: Buffer, plaintext: Buffer): Enc {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}

function decrypt(key: Buffer, e: Enc): Buffer {
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"));
  d.setAuthTag(Buffer.from(e.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(e.ct, "base64")), d.final()]);
}

// Per-tenant pad. credIndex laat meerdere logins per (tenant, portaal) toe (pooling).
function credPath(tenant: string, portal: string, credIndex: number): string {
  return `${VAULT_DIR}/${tenant}/${portal}-${credIndex}.json`;
}

function audit(tenant: string, portal: string, credIndex: number, op: string): void {
  mkdirSync(VAULT_DIR, { recursive: true });
  appendFileSync(`${VAULT_DIR}/audit.log`, `${new Date().toISOString()} ${op} ${tenant}/${portal}#${credIndex}\n`);
}

export function putCredential(tenant: string, portal: string, secret: Record<string, string>, credIndex = 0): void {
  const dek = randomBytes(32);
  const encSecret = encrypt(dek, Buffer.from(JSON.stringify(secret), "utf8"));
  const encDek = encrypt(kek(), dek);
  const path = credPath(tenant, portal, credIndex);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ tenant, portal, credIndex, encDek, encSecret }, null, 2));
  audit(tenant, portal, credIndex, "put");
}

export function getCredential(tenant: string, portal: string, credIndex = 0): Record<string, string> {
  const blob = JSON.parse(readFileSync(credPath(tenant, portal, credIndex), "utf8"));
  const dek = decrypt(kek(), blob.encDek);
  const secret = JSON.parse(decrypt(dek, blob.encSecret).toString("utf8"));
  audit(tenant, portal, credIndex, "get");
  return secret as Record<string, string>;
}

export function hasCredential(tenant: string, portal: string, credIndex = 0): boolean {
  return existsSync(credPath(tenant, portal, credIndex));
}
