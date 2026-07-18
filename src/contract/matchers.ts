// Matching rules voor de contract-test. Diepte §B.1: géén blinde full-payload-
// snapshots (brittle) — maar per veld een regel. Een literal betekent EXACTE match
// (pin business-kritische waarden -> vangt semantische drift). Loosere matchers
// ($type/$pattern/$oneOf) alleen voor velden die legitiem variëren.

export interface Matcher {
  $eq?: unknown;
  $type?: string;
  $pattern?: string;
  $oneOf?: unknown[];
}

/** Geeft null bij match, anders een leesbare foutreden. */
export function matchField(actual: unknown, expected: unknown): string | null {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    const m = expected as Matcher;
    if ("$eq" in m) return Object.is(actual, m.$eq) ? null : reason(m.$eq, actual);
    if (m.$type) return typeof actual === m.$type ? null : `verwacht type ${m.$type}, kreeg ${typeof actual}`;
    if (m.$pattern) return new RegExp(m.$pattern).test(String(actual)) ? null : `voldoet niet aan /${m.$pattern}/: ${JSON.stringify(actual)}`;
    if (m.$oneOf) return m.$oneOf.some((v) => Object.is(v, actual)) ? null : `niet in ${JSON.stringify(m.$oneOf)}: ${JSON.stringify(actual)}`;
  }
  // literal -> exacte match
  return Object.is(actual, expected) ? null : reason(expected, actual);
}

function reason(expected: unknown, actual: unknown): string {
  return `verwacht ${JSON.stringify(expected)}, kreeg ${JSON.stringify(actual)}`;
}
