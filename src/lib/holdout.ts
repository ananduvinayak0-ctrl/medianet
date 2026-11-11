import { hashString } from "./rng";

// Brand-level persistent holdout (decision D4): a shopper's bucket depends only on their
// hashed ID and the brand's salt, so they stay in (or out of) the holdout across every
// campaign. That prevents holdout leakage that would overstate lift.

export function holdoutBucket(idHash: string, salt: string): number {
  return hashString(`${salt}:${idHash}`) % 100;
}

export function isHoldout(bucket: number, holdoutPct: number): boolean {
  return bucket < holdoutPct;
}

export const HOLDOUT_MIN_PCT = 5;
export const HOLDOUT_MAX_PCT = 10;
