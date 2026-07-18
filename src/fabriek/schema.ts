// Config-validatie. Declaratieve data in, getypeerde config uit — of een
// leesbare fout. (In prod een echt JSON Schema; hier met de hand, dependency-vrij.)

export interface FieldRule {
  from: string;
  transform: string;
  args?: string[];
}

export interface FieldsConfig {
  schemaVersion: number;
  flow: string;
  fingerprint: string;
  canonicalize?: { dropFields?: string[] };
  map: Record<string, FieldRule>;
}

export function validateFields(cfg: unknown, knownTransforms: Set<string>): FieldsConfig {
  const errs: string[] = [];
  const c = cfg as FieldsConfig;

  if (c?.schemaVersion !== 1) errs.push(`schemaVersion moet 1 zijn (kreeg ${JSON.stringify(c?.schemaVersion)})`);
  if (!c?.flow) errs.push("flow ontbreekt");
  if (!c?.map || typeof c.map !== "object") errs.push("map ontbreekt of is geen object");

  for (const [field, rule] of Object.entries(c?.map ?? {})) {
    if (!rule?.from) errs.push(`veld '${field}': 'from' ontbreekt`);
    if (!rule?.transform) errs.push(`veld '${field}': 'transform' ontbreekt`);
    else if (!knownTransforms.has(rule.transform))
      errs.push(`veld '${field}': onbekende transform '${rule.transform}' (niet in primitieven of overrides)`);
  }

  if (errs.length) throw new Error("Config-validatie faalde:\n  - " + errs.join("\n  - "));
  return c;
}
