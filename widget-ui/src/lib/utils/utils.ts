// Geport uit v1 src/lib/utils/utils.ts. Wijzigingen: alleen formatDate — v1's tweede
// export (onClickOutside) bestaat in v2 al als eigen module utils/onClickOutside.ts;
// dubbel exporteren zou twee bronnen voor hetzelfde gedrag geven.

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const day = date.getDate();
  const month = date.toLocaleDateString(undefined, { month: 'short' }).replace(/\.$/, "");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${month}·${hh}:${mm}`;
}
