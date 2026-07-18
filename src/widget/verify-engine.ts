// Test van de geporte wizard-engine (provider-agnostisch): tenant-config stuurt de
// skip-toggles, de gedeelde correctheidsregel stuurt de customs-gating, en de step-machine
// (advance) slaat complete stappen over en stopt bij de eerste die render vraagt.

import { loadTenant } from "./tenant.ts";
import { buildSteps } from "./engine/build-steps.ts";
import { buildVisibleSteps, advance } from "./engine/engine.ts";

const tenant = loadTenant("tff-forwarder"); // skipSender + skipReceiver aan
const steps = buildSteps(tenant);
const meta = { tenantId: tenant.id };

let fail = 0;
function check(n: string, ok: boolean): void { console.log(`  ${ok ? "✓" : "✗"} ${n}`); if (!ok) fail++; }

const nlNl: any = { shipperAddress: { country: "NL", postalCode: "1011AB" }, recipientAddress: { country: "NL", postalCode: "3011AA" }, packages: [{}] };
const nlUs: any = { ...nlNl, recipientAddress: { country: "US", postalCode: "10001" } };

// customs-gating via de zichtbare stappen
check("EU→EU: douanestap NIET zichtbaar", !buildVisibleSteps(steps, { shipment: nlNl, ...meta }).some((s) => s.id === "products"));
check("NL→US: douanestap WÉL zichtbaar", buildVisibleSteps(steps, { shipment: nlUs, ...meta }).some((s) => s.id === "products"));

// skip-toggles via de step-machine
const r0 = await advance(steps, nlNl, meta, 0);
check("advance vanaf 0: sender+receiver (compleet) geskipt → rendert 'packages'", r0.type === "render" && r0.step.id === "packages");

// customs-gating via de step-machine (vanaf de douane-index)
const rEu = await advance(steps, nlNl, meta, 3);
check("advance EU-lane vanaf douane: douane geskipt → 'ship'", rEu.type === "render" && rEu.step.id === "ship");
const rUs = await advance(steps, nlUs, meta, 3);
check("advance NL→US vanaf douane: rendert de douanestap", rUs.type === "render" && rUs.step.id === "products");

// lege verzender: sender rendert
const rEmpty = await advance(steps, { packages: [{}] } as any, meta, 0);
check("lege verzender: 'sender' rendert", rEmpty.type === "render" && rEmpty.step.id === "sender");

console.log(fail ? `\nFAIL — ${fail} check(s) fout` : "\nOK — wizard-engine geport, provider-agnostisch: tenant-skip-toggles + customs-gating sturen de step-machine");
process.exit(fail ? 1 : 0);
