// Het sessie-adapter-contract (R2.2/O11). Portaal-agnostisch: de runtime en de pool
// kennen alleen deze interface; per portaal implementeer je alleen een adapter.
//
// v2 (2026-07-18, na de TransHeroes-generalisatie §4.6): de ADAPTER bezit hoe auth op
// een request wordt toegepast (cookie-header of "Bearer <token>") — de pool injecteert
// NIETS meer in de payload (dat was een form/cookie-aanname die niet generaliseerde).
// Plus optionele token-lifecycle voor OAuth-portalen (Bearer + refresh).

export interface Session {
  id: string;
  /** De auth die de adapter zelf op requests toepast: een cookie-header of "Bearer <token>". */
  cookie: string;
  csrf?: string;
  /** OAuth: epoch-ms verloopmoment; de pool refresht proactief hiervoor. Leeg bij cookie-sessies. */
  expiresAt?: number;
  /** OAuth: roterend refresh-token. Leeg bij cookie-sessies. */
  refreshToken?: string | null;
}

export interface PortalResponse {
  status: number;
  loggedOut: boolean;
  body: unknown;
}

export interface PortalAuthAdapter {
  readonly portal: string;
  login(): Promise<Session>;
  submit(session: Session, flow: string, payload: Record<string, unknown>): Promise<PortalResponse>;
  isLoggedOut(resp: PortalResponse): boolean;
  /** Optioneel: goedkope token-refresh (OAuth). Ontbreekt -> de pool doet een volledige re-login. */
  refresh?(session: Session): Promise<Session>;
}
