// Config-validatie. Declaratieve data in, getypeerde config uit — of een leesbare
// fout. Ondersteunt na §4.6: geneste target-paden, `const`-cellen en een `arrays`-blok
// (canonieke collectie -> lijst objecten met per-item sub-map).

export interface FieldRule {
  from?: string;        // input-pad, of "*" voor het hele (array-)item
  transform?: string;
  args?: string[];
  const?: unknown;      // constante cel: geen from/transform nodig
}

export interface ArraySpec {
  from: string;                      // input-pad naar de canonieke collectie
  item: Record<string, FieldRule>;   // sub-map, toegepast per element
}

export interface FieldsConfig {
  schemaVersion: number;
  flow: string;
  fingerprint: string;
  canonicalize?: { dropFields?: string[] };
  map: Record<string, FieldRule>;
  arrays?: Record<string, ArraySpec>;
  referenceData?: Record<string, string>;
}

function validateRule(loc: string, rule: FieldRule, known: Set<string>, errs: string[]): void {
  if (rule && "const" in rule) return; // const-cel
  if (!rule?.from) errs.push(`${loc}: 'from' of 'const' ontbreekt`);
  if (!rule?.transform) errs.push(`${loc}: 'transform' ontbreekt`);
  else if (!known.has(rule.transform)) errs.push(`${loc}: onbekende transform '${rule.transform}'`);
}

export function validateFields(cfg: unknown, known: Set<string>): FieldsConfig {
  const errs: string[] = [];
  const c = cfg as FieldsConfig;

  if (c?.schemaVersion !== 1) errs.push(`schemaVersion moet 1 zijn (kreeg ${JSON.stringify(c?.schemaVersion)})`);
  if (!c?.flow) errs.push("flow ontbreekt");
  if (!c?.map || typeof c.map !== "object") errs.push("map ontbreekt of is geen object");

  for (const [field, rule] of Object.entries(c?.map ?? {})) validateRule(`veld '${field}'`, rule, known, errs);

  for (const [key, spec] of Object.entries(c?.arrays ?? {})) {
    if (!spec?.from) errs.push(`array '${key}': 'from' ontbreekt`);
    if (!spec?.item || typeof spec.item !== "object") errs.push(`array '${key}': 'item'-submap ontbreekt`);
    for (const [subk, subrule] of Object.entries(spec?.item ?? {})) validateRule(`array '${key}'.${subk}`, subrule, known, errs);
  }

  if (errs.length) throw new Error("Config-validatie faalde:\n  - " + errs.join("\n  - "));
  return c;
}
