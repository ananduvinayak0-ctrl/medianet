import { notFound } from "next/navigation";
import { Card, CardBody, PageHeader } from "@/components/ui";

const FEATURES: Record<string, { title: string; when: string; summary: string; scope: string[] }> = {
  "ab-testing": {
    title: "A/B Testing",
    when: "Planned for Q4",
    summary: "Test two creatives or two audiences against each other with an honest answer: a winner, or 'inconclusive'.",
    scope: [
      "Up to 2 variants, one variable at a time (creative or audience)",
      "Sample size fixed before launch (80% power, 5% significance, your minimum detectable effect)",
      "No peeking: a winner is declared only once the planned sample is reached",
      "Test budget capped at 20% of the campaign budget",
      "Results shown as 'inconclusive' when the data can't separate the variants",
    ],
  },
  "ad-studio": {
    title: "Ad Studio (AI copywriting)",
    when: "Planned for Q4",
    summary: "Get AI-suggested headlines and descriptions grounded in your products, with every suggestion policy-checked before you see it.",
    scope: [
      "Provider-agnostic LLM interface (mock first; Claude via the Anthropic API as the first real provider)",
      "No customer personal data is ever sent to the model",
      "Every generated line passes the same automated policy check as manual creatives",
      "You approve every creative; nothing is published automatically",
    ],
  },
};

export default async function ComingSoon({ params }: { params: Promise<{ feature: string }> }) {
  const { feature } = await params;
  const f = FEATURES[feature];
  if (!f) notFound();
  return (
    <>
      <PageHeader title={f.title} description={`${f.when}. ${f.summary}`} />
      <Card className="max-w-2xl">
        <CardBody>
          <div className="mb-2 text-sm font-medium text-slate-700">Planned scope</div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {f.scope.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
