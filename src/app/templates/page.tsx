import Link from "next/link";
import { AdPreview } from "@/components/campaign-bits";
import { Badge, Card, CardBody, PageHeader } from "@/components/ui";
import { getPersona } from "@/lib/personas";
import { TEMPLATES } from "@/lib/templates";

export default function TemplatesPage() {
  return (
    <PageHeaderWrap>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {TEMPLATES.map((t, i) => (
          <Card key={t.key}>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-slate-900">{t.name}</h2>
                {t.kind === "dynamic" && <Badge tone="violet">Dynamic product</Badge>}
              </div>
              <AdPreview templateKey={t.key} headline={t.headline} body={t.body} cta={t.cta} offerCode="COMEBACK15" productIndex={i} />
              <div className="text-xs text-slate-500">
                Best for: {t.recommendedFor.map((k) => getPersona(k).name).join(", ")} · Formats: {t.formats.join(", ")}
              </div>
              <Link href={`/campaigns/new?persona=${t.recommendedFor[0]}&template=${t.key}`} className="inline-block text-sm font-medium text-brand-600 hover:underline">
                Use this template →
              </Link>
            </CardBody>
          </Card>
        ))}
      </div>
    </PageHeaderWrap>
  );
}

function PageHeaderWrap({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Template Hub" description="Ready-to-use, policy-checked ad templates written for retention. Pick one in the wizard and edit the words. AI-written variations arrive with Ad Studio (Q4)." />
      {children}
    </>
  );
}
