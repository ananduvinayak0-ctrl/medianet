import type { PersonaKey } from "./domain";

// Template Hub: ready-to-use, policy-safe ad templates.

export interface AdTemplate {
  key: string;
  name: string;
  kind: "static" | "dynamic"; // dynamic = shows the shopper's exact product from the catalog
  formats: string[];
  headline: string;
  body: string;
  cta: string;
  recommendedFor: PersonaKey[];
  hue: number;
}

export const ALLOWED_CTAS = ["Shop now", "Complete your order", "Buy again", "Learn more", "Get offer", "Explore"] as const;

export const TEMPLATES: AdTemplate[] = [
  {
    key: "dpa-cart",
    name: "Dynamic: still in your cart",
    kind: "dynamic",
    formats: ["native", "300x250", "320x50"],
    headline: "Still thinking it over?",
    body: "Your {product} is waiting. Complete your order before it sells out.",
    cta: "Complete your order",
    recommendedFor: ["cart_abandoners"],
    hue: 25,
  },
  {
    key: "dpa-viewed",
    name: "Dynamic: you looked at this",
    kind: "dynamic",
    formats: ["native", "300x250", "728x90"],
    headline: "Caught your eye?",
    body: "Take another look at {product}. Fresh-roasted and shipped within 48 hours.",
    cta: "Shop now",
    recommendedFor: ["repeat_browsers"],
    hue: 200,
  },
  {
    key: "winback-offer",
    name: "Win-back with offer",
    kind: "static",
    formats: ["native", "300x250", "728x90", "320x50"],
    headline: "We miss you. Here's 15% off",
    body: "Your next bag of fresh coffee is on us (well, 15% of it). Use code {offer}.",
    cta: "Get offer",
    recommendedFor: ["lapsed_buyers"],
    hue: 340,
  },
  {
    key: "cross-sell",
    name: "Complete the ritual",
    kind: "static",
    formats: ["native", "300x250"],
    headline: "Pairs perfectly with your last order",
    body: "Brew it better with our pour-over kit and single-origin sampler.",
    cta: "Explore",
    recommendedFor: ["recent_buyers"],
    hue: 140,
  },
  {
    key: "vip-early-access",
    name: "VIP early access",
    kind: "static",
    formats: ["native", "300x250", "728x90"],
    headline: "First pick, just for you",
    body: "Our limited micro-lot drops tomorrow. Our best customers get 24 hours early access.",
    cta: "Shop now",
    recommendedFor: ["high_value"],
    hue: 280,
  },
  {
    key: "replenish",
    name: "Running low?",
    kind: "static",
    formats: ["native", "300x250", "320x50"],
    headline: "Time for a refill?",
    body: "Reorder your favourite roast in two taps. Free shipping above ₹999.",
    cta: "Buy again",
    recommendedFor: ["recent_buyers", "lapsed_buyers"],
    hue: 40,
  },
];

export function getTemplate(key: string): AdTemplate {
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`Unknown template ${key}`);
  return t;
}
