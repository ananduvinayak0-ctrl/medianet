import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { MultiLine } from "@/components/charts";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { PIXEL_EVENTS } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { EVENT_LABEL, pixelHealth } from "@/lib/pixel";
import { getSession } from "@/lib/session";

export default async function PixelPage() {
  const session = await getSession();
  const rows = await db.pixelEventDaily.findMany({ where: { workspaceId: session.workspace.id }, orderBy: { day: "asc" } });
  const checks = pixelHealth(rows, session.simNow);
  const days = [...new Set(rows.map((r) => r.day))];
  const series = days.map((day) => {
    const p: Record<string, number | string> = { day };
    for (const e of PIXEL_EVENTS) p[e] = rows.find((r) => r.day === day && r.eventType === e)?.count ?? 0;
    return p;
  });

  return (
    <>
      <PageHeader
        title="Pixel health"
        description={`Your Media.net pixel was installed on ${session.workspace.pixelInstalledAt ? formatDate(session.workspace.pixelInstalledAt) : "—"}. Audiences, attribution and the North Star Metric all depend on these events, so we check them continuously.`}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Events per day" description="Last 30 days, by event type" />
          <CardBody>
            <MultiLine data={series} keys={[...PIXEL_EVENTS]} labels={EVENT_LABEL} height={280} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Checks" />
          <ul className="divide-y divide-slate-100">
            {checks.map((c) => {
              const Icon = c.status === "ok" ? CheckCircle2 : c.status === "warn" ? CircleAlert : XCircle;
              const color = c.status === "ok" ? "text-emerald-600" : c.status === "warn" ? "text-amber-600" : "text-red-600";
              return (
                <li key={c.label} className="flex gap-3 px-5 py-3 text-sm">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-label={c.status} />
                  <div>
                    <div className="font-medium text-slate-800">{c.label}</div>
                    <div className="text-slate-600">{c.detail}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Install snippet" description="Paste before </head> on every page, or install the Shopify app (recommended)." />
          <CardBody>
            <pre className="overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">{`<script async src="https://pixel.media.net/v1/mnp.js"></script>
<script>
  window.mnp = window.mnp || [];
  mnp.push(["init", "WS-KAAPI-001", { consent: getConsentState() }]);
  // on checkout:
  mnp.push(["track", "purchase", {
    order_id: "1042", value: 899, currency: "INR",
    email_sha256: sha256(normalise(email))  // hashed in the browser
  }]);
</script>`}</pre>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Event taxonomy" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Used for</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr><td className="px-5 py-2 font-mono text-xs">page_view</td><td className="px-3 py-2">Reach, site visitors</td></tr>
                <tr><td className="px-5 py-2 font-mono text-xs">view_item</td><td className="px-3 py-2">Repeat product viewers, dynamic ads</td></tr>
                <tr><td className="px-5 py-2 font-mono text-xs">add_to_cart</td><td className="px-3 py-2">Cart abandoners</td></tr>
                <tr><td className="px-5 py-2 font-mono text-xs">begin_checkout</td><td className="px-3 py-2">Checkout drop-off, funnel reports</td></tr>
                <tr><td className="px-5 py-2 font-mono text-xs">purchase</td><td className="px-3 py-2">Conversions, recent/lapsed/high-value buyers, NSM (de-duplicated by order_id)</td></tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
