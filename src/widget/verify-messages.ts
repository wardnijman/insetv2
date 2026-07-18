// Test van de i18n-store (stap 3): base-teksten, taalwissel, per-tenant override wint,
// TFF-specifieke teksten uit de componenten gelicht, en onbekende sleutel valt terug.

import { resolveMessages } from "./messages.ts";

let fail = 0;
function check(n: string, ok: boolean): void { console.log(`  ${ok ? "✓" : "✗"} ${n}`); if (!ok) fail++; }

const nl = resolveMessages("acme-standalone", "nl"); // geen overrides -> base
check("base-NL uit de catalogus", nl("action.skip") === "Overslaan" && nl("step.customs") === "Douane");

const en = resolveMessages("acme-standalone", "en");
check("taalwissel naar EN", en("action.skip") === "Skip" && en("step.customs") === "Customs");

const tff = resolveMessages("tff-forwarder", "nl"); // heeft overrides
check("tenant-override wint (TFF logout-tekst)", tff("notice.loggedOut") === "Je bent uitgelogd bij TFF");
check("TFF-specifieke tekst (DDP €43) uit de component gelicht", tff("notice.ddpClearance") === "Inklaringskosten: € 43,-");
check("niet-overschreven sleutel valt terug op base", tff("action.skip") === "Overslaan");

check("onbekende sleutel -> de sleutel zelf (geen crash)", nl("does.not.exist") === "does.not.exist");

console.log(fail ? `\nFAIL — ${fail} check(s) fout` : "\nOK — i18n-store: base + taal + per-tenant override; hardcoded NL/TFF-teksten uit de componenten");
process.exit(fail ? 1 : 0);
