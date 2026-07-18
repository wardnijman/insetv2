// Credential-vault (R4.4). Envelope-encryptie: per portaal een eigen Data Encryption
// Key (DEK) die de creds versleutelt; de DEK zelf wordt versleuteld met de master-key
// (KEK). Elke get/put wordt geaudit. Nul plaintext at rest, nul secrets in git.
// Dit is de directe tegenhanger van de v1-doodzonde (plaintext creds in config.json, §8).
//
// De KEK komt uit process.env.INSET_MASTER_KEY (32 bytes, base64) — in prod uit een KMS,
// nooit uit de repo. Faalt gesloten als de key ontbreekt of niet klopt.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";

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

function audit(portal: string, op: string): void {
  mkdirSync(VAULT_DIR, { recursive: true });
  appendFileSync(`${VAULT_DIR}/audit.log`, `${new Date().toISOString()} ${op} ${portal}\n`);
}

/** Versleutel en bewaar een credential-blob per portaal (envelope). */
export function putCredential(portal: string, secret: Record<string, string>): void {
  const dek = randomBytes(32);
  const encSecret = encrypt(dek, Buffer.from(JSON.stringify(secret), "utf8"));
  const encDek = encrypt(kek(), dek); // DEK versleuteld met de master-key
  mkdirSync(VAULT_DIR, { recursive: true });
  writeFileSync(`${VAULT_DIR}/${portal}.json`, JSON.stringify({ portal, encDek, encSecret }, null, 2));
  audit(portal, "put");
}

/** Ontsleutel de creds van een portaal. Faalt (throws) bij ontbrekende/verkeerde KEK. */
export function getCredential(portal: string): Record<string, string> {
  const blob = JSON.parse(readFileSync(`${VAULT_DIR}/${portal}.json`, "utf8"));
  const dek = decrypt(kek(), blob.encDek);
  const secret = JSON.parse(decrypt(dek, blob.encSecret).toString("utf8"));
  audit(portal, "get");
  return secret as Record<string, string>;
}

export function hasCredential(portal: string): boolean {
  return existsSync(`${VAULT_DIR}/${portal}.json`);
}
