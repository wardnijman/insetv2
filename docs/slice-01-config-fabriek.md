# Slice 1 — config-formaat + fabriek + contract-test

*2026-07-18. Eerste draaiende bewijs van de v2-kern (zie `../plugship/docs/v2-architectuur.md` §11, en diepte §A/§B). Dependency-vrij, draait op Node 22 met type-stripping.*

## Wat dit bewijst

1. **Bron/afgeleid-grens (de regel die v1 mist).** `portals/tff/` bevat alleen declaratieve bron; `generated/` bevat de gecompileerde module en is `.gitignore` (zie `git status`: `generated/` verschijnt niet). De gegenereerde `transform` is **pure lijm** — geen logica, alleen wiring die primitieven bij naam aanroept (compositie boven generatie, O9).
2. **Compositie-overrides.** Generieke primitieven in `src/primitives/`; TFF-eigen logica (`isoToTffCountry`, `postcodeOrGeen`) in `portals/tff/rules/overrides.ts`. De fabriek merget beide en faalt hard op een onbekende transform-naam.
3. **Canonicalisatie-pass.** `_token` (volatiel) wordt uit de payload gestript vóór vergelijken (§A.4).
4. **O19 — semantische/stille drift wordt gevangen.** De contract-test toetst de payload veld-voor-veld met matching rules; business-kritische velden zijn EXACT gepind. Bewezen: `kgToGrams` ×1000→×100 (een boeking die structureel "slaagt" maar het verkeerde gewicht stuurt) → `gewicht: verwacht 2500, kreeg 250`, exit 1.

## Draaien

```
npm run compile          # portals/tff/*.json -> generated/tff/getRates.ts
npm run contract-test    # golden fixtures -> groen/rood (exit 1 bij drift)
```

## Structuur

```
portals/tff/            BRON (in git)          src/
  portal.json                                    primitives/index.ts   generieke primitieven
  flow.json                                      fabriek/compile.ts    DE FABRIEK
  fields.json           declaratieve veldmap     fabriek/schema.ts     config-validatie
  rules/overrides.ts    portaal-eigen logica     fabriek/helpers.ts    getPath/canonicalize/hash
  fixtures/*.golden.json gouden standaard         contract/matchers.ts  matching rules
generated/  AFGELEID (.gitignore)                contract/contract-test.ts
```

## Nog niet in deze slice (bewust)

- Echte recorder (O12) — de fixtures zijn nu handgeschreven; volgende slice = een HAR/DOM-opname als input.
- Runtime/sessie-adapter (R2.2), widget, wizard-engine.
- Live drift-probe (laag 3) — hier alleen laag 0.
- TOML i.p.v. JSON voor de config (leesbaarheid; mechanisme identiek).
- Prod-schema-validatie via echt JSON Schema i.p.v. de handmatige check.
