// TransHeroes-EIGEN primitieven (escape-hatch, O9). Reference-data-transforms leven
// hier omdat ze een portaal-eigen tabel importeren — de JSON-tegenhanger van TFF's
// land-pcformat. Generieke primitieven staan in src/primitives.

import type { Primitive } from "../../../src/primitives/index.ts";
import countryIds from "../country-ids.json" with { type: "json" };

export const overrides: Record<string, Primitive> = {
  isoToCountryId: (v) => {
    const id = (countryIds as Record<string, number>)[String(v)];
    if (id == null) throw new Error(`No TransHeroes country id for ISO: ${v}`);
    return id;
  },

  // package type -> TransHeroes goodsType id (uit GET /goods-types): pallet=1, anders 23.
  packageTypeToGoodsTypeId: (v) => (v === "pallet" ? 1 : 23),

  // from: "*" -> krijgt het hele item; laadmeters ≈ (L*B in m²) / 2.4 (trailerbreedte).
  loadMetersFromLxW: (item: any) => {
    const m = (Number(item.length) / 100) * (Number(item.width) / 100) / 2.4;
    return Math.round(m * 100) / 100;
  },
};
