// Het sessie-adapter-contract (R2.2/O11). Portaal-agnostisch: de runtime en de pool
// kennen alleen deze interface; per portaal implementeer je alleen een adapter
// (TFF = Laravel-sessie, TransHeroes = Passport, Freightwatch = ColdFusion+REMEMBERME).

export interface Session {
  id: string;
  csrf: string;
  cookie: string;
}

export interface PortalResponse {
  status: number;
  loggedOut: boolean;
  body: unknown;
}

export interface PortalAuthAdapter {
  readonly portal: string;
  /** Naam van het CSRF/token-veld dat uit de sessie in de payload moet (niet uit de widget-input). */
  readonly csrfField: string;
  login(): Promise<Session>;
  submit(session: Session, flow: string, payload: Record<string, unknown>): Promise<PortalResponse>;
  isLoggedOut(resp: PortalResponse): boolean;
}
