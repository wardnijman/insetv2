// Geport uit v1 src/lib/utils/img.ts. Wijzigingen: geen — apiBaseUrl komt uit de
// tenant-config (proxy-first). NB: de proxy serveert /img/ (nog) niet; de enige
// consument (platform-avatar in OrderRow) degradeert dan naar de alt-tekst.
// TODO(order-flow): platform-iconen via de proxy serveren.

import { apiBaseUrl } from "../api/global";

export type Fit = "cover" | "contain" | "fill" | "inside" | "outside";

export function img(
  rel: string,
  opts: { w?: number; h?: number; fit?: Fit; q?: number; format?: "avif"|"webp"|"jpeg"|"png" } = {}
) {
  // ensure no leading slash so [...key] sees segments correctly
  const safeRel = rel.replace(/^\/+/, "");
  const base = apiBaseUrl.replace(/\/+$/, ""); // no trailing slash

  const u = new URL(`${base}/img/${safeRel}`);
  if (opts.w) u.searchParams.set("w", String(opts.w));
  if (opts.h) u.searchParams.set("h", String(opts.h));
  if (opts.fit) u.searchParams.set("fit", opts.fit);
  if (opts.q) u.searchParams.set("q", String(opts.q));
  if (opts.format) u.searchParams.set("format", opts.format);
  u.searchParams.set("v", "4")

  // IMPORTANT: keep the origin; don't return only pathname
  return u.toString();
}
