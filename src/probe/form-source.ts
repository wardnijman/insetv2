// Bron van de HUIDIGE portaal-form voor de drift-probe. In prod: fetch de form-pagina
// (of het API-schema) en parse de velden. Hier een in-memory set die de begintoestand
// van het TFF getRates-formulier weerspiegelt; via de env-var INSET_DRIFT simuleer je
// een portaal-wijziging om de detectie te tonen.

const BASELINE: string[] = [
  "verzender_land", "verzender_postcode", "verzender_straat",
  "ontvanger_land", "ontvanger_postcode", "ontvanger_straat",
  "gewicht", "_token", "hp_email",
];

export async function fetchCurrentForm(_portal: string, _flow: string): Promise<{ fields: string[] }> {
  let fields = [...BASELINE];
  switch (process.env.INSET_DRIFT) {
    case "add-btw":
      fields = [...fields, "btw_nummer"]; // portaal voegt een verplicht veld toe
      break;
    case "rename-gewicht":
      fields = fields.map((f) => (f === "gewicht" ? "weight_kg" : f)); // veld hernoemd
      break;
    case "extra-honeypot":
      fields = [...fields, "hp_phone"]; // nieuw honeypot -> mag GEEN drift geven (volatiel)
      break;
  }
  return { fields };
}
