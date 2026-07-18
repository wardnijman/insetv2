// NL adres-lookup via de PDOK Locatieserver (officiële, gratis Kadaster-API op
// BAG-data; CORS-open, geen API-key). Postcode + huisnummer → straatnaam +
// woonplaats. Bewust géén Google Places: dit is exacte adresdata i.p.v. fuzzy
// search, en er is geen key/kostenbeheer nodig in de widget.
export type NlAddressHit = { street: string; city: string };

export function isNlPostcode(pc: string): boolean {
  return /^\d{4}\s?[A-Za-z]{2}$/.test(pc.trim());
}

export async function lookupNlAddress(
  postcode: string,
  houseNumber: string,
): Promise<NlAddressHit | null> {
  const pc = postcode.replace(/\s+/g, "").toUpperCase();
  const q = `${pc} ${houseNumber.trim()}`;
  const url =
    "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free" +
    `?fq=type:adres&rows=1&fl=straatnaam,woonplaatsnaam,postcode,huisnummer&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDOK ${res.status}`);
  const data = await res.json();
  const doc = data?.response?.docs?.[0];
  if (!doc?.straatnaam || !doc?.woonplaatsnaam) return null;
  // Alleen een exacte postcode-match accepteren — de fuzzy search "vindt" anders
  // het dichtstbijzijnde adres in een andere straat en dat is erger dan niets.
  if ((doc.postcode ?? "").toUpperCase() !== pc) return null;
  return { street: doc.straatnaam, city: doc.woonplaatsnaam };
}
