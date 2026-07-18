// Sessiepool (R2.2) met gestandaardiseerde faalsemantiek (R2.3): één keer opgelost,
// niet per endpoint. Leaset/hergebruikt een sessie; injecteert de CSRF uit de sessie;
// bij "uitgelogd" -> retire + re-login + één retry (les van de getRates-hang).

import type { PortalAuthAdapter, Session, PortalResponse } from "./adapter.ts";

export class SessionPool {
  adapter: PortalAuthAdapter;
  session: Session | null = null;

  constructor(adapter: PortalAuthAdapter) {
    this.adapter = adapter;
  }

  async lease(): Promise<Session> {
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
    const send = async (): Promise<PortalResponse> => {
      const s = await this.lease();
      // CSRF komt uit de sessie, niet uit de widget-input.
      return this.adapter.submit(s, flow, { ...payload, [this.adapter.csrfField]: s.csrf });
    };

    let resp = await send();
    if (this.adapter.isLoggedOut(resp)) {
      console.log(`  [pool] uitgelogd (status ${resp.status}) -> re-login + retry`);
      this.retire();
      resp = await send();
      if (this.adapter.isLoggedOut(resp)) {
        throw new Error("nog steeds uitgelogd na re-login");
      }
    }
    return resp;
  }
}
