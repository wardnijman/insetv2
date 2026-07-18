// Test van de capability-guard (R1.3): de guard moet Mainfreight + express blokkeren,
// TransHeroes blokkeren zolang verwijderen niet geverifieerd is, en veilige diensten
// (DPD Classic, UPS Standard) doorlaten.

import { assertBookable } from "./capabilities.ts";

const cases: Array<{ portal: string; rate: { carrier: string; service: string }; expect: "allow" | "block" }> = [
  { portal: "tff", rate: { carrier: "DPD", service: "Classic" }, expect: "allow" },
  { portal: "tff", rate: { carrier: "UPS", service: "Standard" }, expect: "allow" },
  { portal: "tff", rate: { carrier: "Mainfreight", service: "Road" }, expect: "block" },
  { portal: "tff", rate: { carrier: "DHL", service: "Express Domestic" }, expect: "block" },
  { portal: "tff", rate: { carrier: "UPS", service: "Saver" }, expect: "block" },
  { portal: "tff", rate: { carrier: "DHL", service: "Express Domestic 9:00" }, expect: "block" },
  { portal: "transheroes", rate: { carrier: "TransHeroes", service: "Road" }, expect: "block" },
];

let fail = 0;
for (const c of cases) {
  let outcome: "allow" | "block";
  try {
    assertBookable(c.portal, c.rate);
    outcome = "allow";
  } catch {
    outcome = "block";
  }
  const ok = outcome === c.expect;
  if (!ok) fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${c.portal.padEnd(11)} ${c.rate.carrier}/${c.rate.service} -> ${outcome} (verwacht ${c.expect})`);
}

console.log(fail ? `\nFAIL — ${fail} case(s) fout` : "\nOK — guard blokkeert Mainfreight/express + TransHeroes-onverwijderbaar, laat DPD Classic / UPS Standard door");
process.exit(fail ? 1 : 0);
