// Mock Shopify catalog used by dynamic product ads (decision D1).
// In production this syncs from the Shopify Admin API.

export interface Product {
  id: string;
  name: string;
  pricePaise: number;
  hue: number; // placeholder imagery colour
}

export const CATALOG: Product[] = [
  { id: "p1", name: "Chikmagalur Estate Dark Roast · 250g", pricePaise: 64900, hue: 25 },
  { id: "p2", name: "Cold Brew Concentrate · 6-pack", pricePaise: 89900, hue: 200 },
  { id: "p3", name: "Single-Origin Sampler · 4 × 100g", pricePaise: 119900, hue: 140 },
  { id: "p4", name: "Ceramic Pour-Over Kit", pricePaise: 149900, hue: 280 },
  { id: "p5", name: "Filter Coffee Decoction Blend · 500g", pricePaise: 54900, hue: 40 },
  { id: "p6", name: "Coffee Subscription · 3 months", pricePaise: 249900, hue: 340 },
];
