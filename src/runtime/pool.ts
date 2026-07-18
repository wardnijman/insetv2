// Sessiepool (R2.2) met gestandaardiseerde faalsemantiek (R2.3): één keer opgelost,
// niet per endpoint. Leaset/hergebruikt een sessie; de ADAPTER past auth zelf toe
// (geen body-injectie meer). Token-lifecycle (§4.6): proactieve refresh vóór verloop,
// en bij "uitgelogd" eerst een goedkope refresh() en anders een volledige re-login.

import type { PortalAuthAdapter, Session, PortalResponse } from "./adapter.ts";

const REFRESH_SKEW_MS = 60_000; // ververs 60s vóór expiry

export class SessionPool {
  adapter: PortalAuthAdapter;
  session: Session | null = null;

  constructor(adapter: PortalAuthAdapter) {
    this.adapter = adapter;
  }

  isExpiring(s: Session): boolean {
    return typeof s.expiresAt === "number" && s.expiresAt - Date.now() <= REFRESH_SKEW_MS;
  }

  async refreshOrRelogin(s: Session): Promise<Session> {
    if (this.adapter.refresh && s.refreshToken) {
      try {
        const ns = await this.adapter.refresh(s);
        console.log(`  [pool] refresh -> ${ns.id}`);
        return ns;
      } catch (e) {
        console.log(`  [pool] refresh faalde (${(e as Error).message}) -> volledige re-login`);
      }
    }
    const ns = await this.adapter.login();
    console.log(`  [pool] login -> ${ns.id}`);
    return ns;
  }

  async lease(): Promise<Session> {
    if (this.session && this.isExpiring(this.session)) {
      console.log(`  [pool] token verloopt bijna -> proactieve refresh`);
      this.session = await this.refreshOrRelogin(this.session);
    }
    if (!this.session) {
      this.session = await this.adapter.login();
      console.log(`  [pool] login -> ${this.session.id}`);
    }
    return this.session;
  }

  retire(): void {
    if (this.session) {
      console.log(`  [pool] retire ${this.session.id}`);
      this.session = null;
    }
  }

  async submit(flow: string, payload: Record<string, unknown>): Promise<PortalResponse> {
    // De adapter past auth zelf toe; de pool injecteert niets in de payload.
    const s = await this.lease();
    let resp = await this.adapter.submit(s, flow, payload);
    if (this.adapter.isLoggedOut(resp)) {
      console.log(`  [pool] uitgelogd (status ${resp.status}) -> refresh/re-login + retry`);
      this.session = await this.refreshOrRelogin(s);
      resp = await this.adapter.submit(this.session, flow, payload);
      if (this.adapter.isLoggedOut(resp)) {
        throw new Error("nog steeds uitgelogd na refresh/re-login");
      }
    }
    return resp;
  }
}
