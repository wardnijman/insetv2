// Gedeelde, generieke transform-primitieven. Portaal-onafhankelijk, unit-testbaar.
// Portaal-EIGEN logica hoort NIET hier maar in portals/<portal>/rules/overrides.ts.
// De config verwijst bij naam naar deze functies (compositie boven generatie, O9).

export type Primitive = (value: unknown, ...args: unknown[]) => unknown;

export const primitives: Record<string, Primitive> = {
  identity: (v) => v,
  trim: (v) => String(v ?? "").trim(),
  dashIfEmpty: (v) => {
    const s = String(v ?? "").trim();
    return s === "" ? "-" : s;
  },
  upper: (v) => String(v ?? "").toUpperCase(),
  kgToGrams: (v) => Math.round(Number(v) * 1000),
};
