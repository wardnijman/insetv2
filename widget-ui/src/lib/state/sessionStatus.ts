// Geport uit v1 src/lib/state/sessionStatus.ts. Wijzigingen: geen mechaniek — maar in
// v2 (proxy-first) leeft de portaalsessie SERVERSIDE in de SessionPool met auto-relogin,
// dus markLoggedOut heeft nu geen aanroeper: v1's detectiepunt (authFetch die
// TFF-responses sniffte) bestaat client-side niet meer. De store + banner blijven staan
// voor het moment dat de proxy een logged-out-signaal gaat doorgeven. TODO(order-flow).

import { writable } from "svelte/store";

export type SessionStatus = "ok" | "logged_out";

export const sessionStatus = writable<SessionStatus>("ok");

export function markLoggedOut() {
  sessionStatus.update((s) => (s === "logged_out" ? s : "logged_out"));
}

export function markLoggedIn() {
  sessionStatus.update((s) => (s === "ok" ? s : "ok"));
}

// Classify a portal response body as logged-out. Cheap signals (status / redirect-to-login)
// are checked synchronously by the caller; this body sniff is only run on already-failed
// responses. (v1: gespiegeld aan de server-side heuristiek in tffSessionService.)
export function bodyLooksLoggedOut(body: string): boolean {
  const b = (body || "").toLowerCase();
  if (b.includes('name="user"') && b.includes('name="pass"')) return true;
  if (b.includes("inloggen") && b.includes("wachtwoord")) return true;
  if (b.includes("login") && b.includes("password")) return true;
  if (/"error"[^}]*(log\s?in|ingelogd|sessie|session|expired|verlopen)/.test(b))
    return true;
  return false;
}
