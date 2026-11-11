import type { PixelEventDaily } from "@prisma/client";
import { PIXEL_EVENTS, type PixelEvent } from "./domain";
import { DAY, istDayKey } from "./time";

// Pixel health (decision D2): everything downstream (personas, attribution, NSM) depends on
// clean events, so we check them continuously and say plainly what's wrong.

export const EVENT_LABEL: Record<PixelEvent, string> = {
  page_view: "Page view",
  view_item: "Product view",
  add_to_cart: "Add to cart",
  begin_checkout: "Begin checkout",
  purchase: "Purchase",
};

export interface HealthCheck {
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export function pixelHealth(rows: PixelEventDaily[], now: Date): HealthCheck[] {
  const yesterday = istDayKey(new Date(now.getTime() - DAY));
  const today = istDayKey(now);
  const recentDays = new Set([today, yesterday]);
  const byType = (t: PixelEvent, days?: Set<string>) => rows.filter((r) => r.eventType === t && (!days || days.has(r.day)));
  const sum = (rs: PixelEventDaily[], k: "count" | "duplicates" | "withConsent" = "count") => rs.reduce((a, r) => a + r[k], 0);

  const checks: HealthCheck[] = [];
  for (const t of PIXEL_EVENTS) {
    const recent = sum(byType(t, recentDays));
    const before = sum(byType(t)) - recent;
    if (recent === 0 && before > 0) {
      checks.push({ label: `${EVENT_LABEL[t]} events`, status: "fail", detail: `No ${t} events in the last 48 hours, but they were firing before. This often happens after a theme or checkout update. Re-check the pixel on that page.` });
    } else if (recent === 0) {
      checks.push({ label: `${EVENT_LABEL[t]} events`, status: "warn", detail: `We've never received ${t}. Add it to unlock better audiences.` });
    } else {
      checks.push({ label: `${EVENT_LABEL[t]} events`, status: "ok", detail: `${recent.toLocaleString("en-IN")} received in the last 48 hours.` });
    }
  }

  const purchases = byType("purchase");
  const dupRate = sum(purchases) > 0 ? sum(purchases, "duplicates") / sum(purchases) : 0;
  checks.push({
    label: "Duplicate purchases",
    status: dupRate > 0.03 ? "fail" : dupRate > 0.01 ? "warn" : "ok",
    detail: `${(dupRate * 100).toFixed(1)}% of purchase events are duplicates (same order ID). We de-duplicate them, but above 1% usually means the thank-you page fires twice.`,
  });

  const all = rows;
  const consentRate = sum(all) > 0 ? sum(all, "withConsent") / sum(all) : 0;
  checks.push({
    label: "Consent signal",
    status: consentRate < 0.9 ? "warn" : "ok",
    detail: `${(consentRate * 100).toFixed(0)}% of events carry a consent signal. Events without consent are never used for targeting (DPDP Act 2023).`,
  });
  return checks;
}

export function healthSummary(checks: HealthCheck[]): "ok" | "warn" | "fail" {
  return checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
}
