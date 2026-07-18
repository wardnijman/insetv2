// Client for the AI address parser: pasted text (e-mail, signature, order
// confirmation) → structured recipient address. The caller is responsible for
// validating the result with the TFF field validators before filling the form.

import { apiBaseUrl } from "./global";

export type ParsedAddressFields = {
  company: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  street: string;
  streetAddition: string;
  postalCode: string;
  city: string;
  region: string;
  country: string;
};

export type ParseAddressResult =
  | { ok: true; address: ParsedAddressFields }
  | { ok: false; error: "not_found" | "rate_limited" | "ai_not_configured" | "parse_failed"; retryAfterS?: number };

export async function parseAddressText(
  userId: string,
  text: string,
): Promise<ParseAddressResult> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/ai/parse-address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, text }),
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data?.ok && data.address) {
      return { ok: true, address: data.address as ParsedAddressFields };
    }

    if (res.status === 429) {
      return { ok: false, error: "rate_limited", retryAfterS: data?.retryAfterS };
    }
    if (res.status === 503) {
      return { ok: false, error: "ai_not_configured" };
    }
    if (data?.error === "not_found") {
      return { ok: false, error: "not_found" };
    }
    return { ok: false, error: "parse_failed" };
  } catch (err) {
    console.error("AI address parse failed", err);
    return { ok: false, error: "parse_failed" };
  }
}
