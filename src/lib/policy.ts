import { ALLOWED_CTAS } from "./templates";

// Automated creative policy check. Runs before launch on every creative, including future
// AI-generated copy. Errors block launch; warnings are shown but don't block.
// Prohibited list approximates Media.net policy + ASCI guidelines (illustrative for MVP).

export interface PolicyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const PROHIBITED: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(casino|betting|satta|gambl\w*)\b/i, reason: "Gambling and betting ads aren't allowed." },
  { pattern: /\b(cigarette|tobacco|vape|gutkha)\b/i, reason: "Tobacco and vaping products aren't allowed." },
  { pattern: /\b(guaranteed (cure|returns?|results?)|100% guaranteed)\b/i, reason: "Guaranteed-outcome claims aren't allowed (ASCI)." },
  { pattern: /\blose \d+ ?kg\b|\bweight loss in \d+ days\b/i, reason: "Specific weight-loss claims aren't allowed (ASCI)." },
  { pattern: /\b(crypto|bitcoin) (profits?|returns?)\b/i, reason: "Financial-return claims aren't allowed." },
];

const NEEDS_SUBSTANTIATION = /\b(no\.? ?1|number one|best in india|#1)\b/i;

export const LIMITS = { headline: 40, body: 90 };

export function checkCreative(input: { headline: string; body: string; cta: string; landingUrl: string }): PolicyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = `${input.headline} ${input.body}`;

  if (!input.headline.trim()) errors.push("Headline is required.");
  if (input.headline.length > LIMITS.headline) errors.push(`Headline is ${input.headline.length} characters (max ${LIMITS.headline}).`);
  if (!input.body.trim()) errors.push("Description is required.");
  if (input.body.length > LIMITS.body) errors.push(`Description is ${input.body.length} characters (max ${LIMITS.body}).`);
  if (!(ALLOWED_CTAS as readonly string[]).includes(input.cta)) errors.push(`CTA must be one of: ${ALLOWED_CTAS.join(", ")}.`);

  try {
    const u = new URL(input.landingUrl);
    if (u.protocol !== "https:") errors.push("Landing page must use https://");
    if (!/[?&]utm_source=/.test(u.search)) warnings.push("No UTM tags. We'll add utm_source=medianet automatically so your store analytics can cross-check results.");
  } catch {
    errors.push("Landing page URL isn't valid.");
  }

  for (const p of PROHIBITED) if (p.pattern.test(text)) errors.push(p.reason);
  if (NEEDS_SUBSTANTIATION.test(text)) warnings.push('Superlative claims like "No.1" need substantiation under ASCI guidelines. Expect manual review.');
  if (/[A-Z]{6,}/.test(text)) warnings.push("Long ALL-CAPS text tends to lower CTR and may be flagged in review.");

  return { ok: errors.length === 0, errors, warnings };
}

export function withUtm(url: string, campaignCode: string): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "medianet");
    if (!u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", campaignCode);
    return u.toString();
  } catch {
    return url;
  }
}
