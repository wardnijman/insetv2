// Geport uit v1 src/lib/utils/carrierLogo.ts. Wijzigingen: geen. De paden zijn relatief
// aan de hostpagina (TFF-back-office); standalone (dev-harness) laden ze niet en valt de
// carrier-kolom via de ingebouwde onerror-fallback terug op tekst — dat is v1-gedrag.

// Maps a stored shipment carrier name back to the same TFF-hosted logo the rate list
// shows (rate.imgUrl, e.g. "img/dhl.png"). Those paths are relative to the TFF
// back-office page the widget is injected into, so they resolve here identically.
//
// Every path below is verified against real getRates pulls (dev-scripts/.tmp) and the
// flow-example page captures — these 8 are the only logos TFF's rate table ever serves,
// plus img/xpo.png which exists on the page. Spoedkoerier rows (TFFXPRESS/Rijo) carry
// no logo at all in TFF's table; they intentionally fall back to text here.
// Unknown carriers return null → caller falls back to the text rendering.
const LOGO_BY_CARRIER: Record<string, string> = {
  dhl: "img/dhl.png",
  dhlparcel: "img/dhlparcel.png",
  dpd: "img/dpd.png",
  fedex: "img/fedex.png",
  fed: "img/fedex.png",
  ups: "img/upslogo.svg",
  mainfreight: "img/mainfreight.png",
  mfn: "img/mainfreight.png",
  tff: "img/tff.png",
  cts: "img/cts.png",
  xpo: "img/xpo.png",
};

// Older transform versions stored the raw logo filename as the carrier ("dhl.png",
// "upslogo") — strip extension and trailing "logo" so those records match too.
function carrierKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(png|svg|jpe?g|gif|webp)$/, "")
    .replace(/logo$/, "")
    .replace(/[^a-z0-9]/g, "");
}

export function carrierLogoUrl(carrier?: string | null): string | null {
  if (!carrier) return null;
  return LOGO_BY_CARRIER[carrierKey(carrier)] ?? null;
}

// A TFF-brokered shipment stores carrier "tff" while the service names the real
// carrier ("Ups standard"). For logo-only rendering the underlying carrier's mark is
// the informative one — map the service's first word to a logo when it names one.
export function serviceLogoUrl(service?: string | null): string | null {
  if (!service) return null;
  const first = service.trim().split(/\s+/)[0];
  return first ? (LOGO_BY_CARRIER[carrierKey(first)] ?? null) : null;
}

// TFF stores service names sentence-cased ("Ups standard", "Fedex international
// priority"); fix the casing word-by-word so they read as product names.
const CASING: Record<string, string> = {
  ups: "UPS",
  dhl: "DHL",
  dpd: "DPD",
  tff: "TFF",
  fedex: "FedEx",
  tnt: "TNT",
  xpo: "XPO",
  cts: "CTS",
  mfn: "MFN",
  eu: "EU",
};

export function formatServiceName(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => {
      const mapped = CASING[w.toLowerCase()];
      if (mapped) return mapped;
      // Only title-case fully-lowercase words; anything with deliberate casing stays.
      return w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(" ");
}
