// Geport uit v1 src/lib/utils/optionLabels.ts. Wijzigingen: geen (pure helper).
// Accepts: array of strings OR {value,label}[], plus a dictionary.
// Returns: {value,label}[] with translated labels; falls back to provided label/value.
export function translateOptions(
  opts: Array<string | { value: string; label?: string }> | undefined,
  dict?: Record<string, string>
): { value: string; label: string }[] {
  if (!opts || opts.length === 0) return [];
  return opts.map((o) => {
    const value = typeof o === "string" ? o : o.value;
    const fallback = typeof o === "string" ? o : (o.label ?? value);
    const key = normalizeKey(value);
    const label = (dict && (dict[key] ?? dict[value])) ?? fallback;
    return { value, label };
  });
}

function normalizeKey(v: string): string {
  return v.trim().toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
