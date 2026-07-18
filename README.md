# Inset v2

Uniform verzendcontract — API + geteste widget + drift-detectie — per forwarder gevoed door **browser-discovery**. Greenfield herbouw van [plugship](../plugship) (v1), als strangler: v1 blijft draaien, onderdelen migreren één voor één. Geen big-bang rewrite.

## These (discovery-first)

Discovery is de kern en het strategische eindpunt. Een vendor-API is architectureel hetzelfde adapter-contract zonder drift, en wordt alleen opportunistisch meegenomen als een concrete klant erom vraagt — geen strategisch spoor.

Waarom discovery en niet de vendor-route:
- **Trust-asymmetrie** — de forwarder hoeft zijn kern-IT niet open te zetten; de eindklant deelt alleen een portaallogin dat hij toch al heeft.
- **Permissionless go-to-market** — een portaal ondersteunen vereist geen deal met forwarder of vendor. Eerst supporten, dán verkopen.
- **Geen moat op adapters** — een vendor-adapter bouwt iedereen na. De verdedigbare kern is de zelfherstellende loop, niet de scraping.

De moat is de **volautomatische loop**: drift detecteren → herontdekken → regenereren → contract-testen → deployen. Discovery is de ingest; de loop is het product.

## Harde regels (dag 1)

1. **Geen secrets in de repo, ooit.** Zie `.env.example`; klant-credentials horen in een versleutelde per-tenant vault. (Directe les uit v1 — zie dossier §8.)
2. **Gegenereerde code buiten git.** Generatie is een build-stap naar een genegeerde output-dir; hand-logica leeft alleen in declaratieve per-portaal bronpakketten die regeneratie overleven.
3. **Discovery en beheer volledig geautomatiseerd, Ward-vrij.** Flows, POST-sequenties, landenmatrices en fingerprints worden nooit met de hand aangeraakt; per portaal één compacte, leesbare config. Ward doet alleen klant-uitzonderingen en commerciële keuzes.
4. **Alles testbaar met een gouden standaard.** Fixtures elke commit; wekelijkse drift-probes; echte boekingen alleen als expliciete per-carrier capability.

## Waar wat staat

- **`docs/v2-onderzoeksdossier.md`** — het levende dossier: randvoorwaarden (R1–R5), besluiten (B1–B10), bevindingen van de drie onderzoekssporen, open onderzoeksvragen (O1–O17), assets en risico's. Start hier.

## Status

Greenfield. Onderzoeks- en ontwerpfase. Nog geen applicatiecode — architectuurbesluiten (adapter-contract, DB-keuze, observability-stack) staan open in het dossier en worden eerst beslecht in het v2-ontwerpdoc.
