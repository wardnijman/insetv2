// Geport uit v1 src/lib/types/search.d.ts. Wijzigingen: geen.
// Zoek-/filtertokens van de order-overview (SearchFilterBar + state/orderFilters).

export type StatusKey = "NEW" | "CREATED" | "AFGEROND" | "CANCELED" | "UNPLANNED" | "FAILED";

export type StatusToken = { id: "status"; type: "status"; values: StatusKey[] };
export type PlatformToken = { id: "platform"; type: "platform"; values: string[] };

export type DateToken = {
  id: "date";
  type: "date";
  mode: "created" | "updated";
  from?: string;
  to?: string;
};

export type DepthValue = "current" | "year" | "all";
export type DepthToken = { id: "depth"; type: "depth"; value: DepthValue };

export type Token = StatusToken | PlatformToken | DateToken | DepthToken;


export type SearchFilters = {
  platforms?: string[];
  countries?: string[];
  cities?: string[];
  companies?: string[];
  emails?: string[];
  skus?: string[];
  statuses?: StatusKey[];
  date?: { mode: "created"|"updated"; from: string; to: string }; // only present when both supplied
};

export type LastOrderFilters = {
  q: string;
  filters: SearchFilters;
  savedAt: string; // ISO
};
