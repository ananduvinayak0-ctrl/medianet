// Domain enums (stored as strings in the DB; validated here).

export const ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const OBJECTIVES = ["retarget", "reactivate"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const PERSONA_KEYS = [
  "cart_abandoners",
  "repeat_browsers",
  "recent_buyers",
  "lapsed_buyers",
  "high_value",
] as const;
export type PersonaKey = (typeof PERSONA_KEYS)[number];

export const CAMPAIGN_STATUSES = [
  "draft",
  "pending_approval",
  "scheduled",
  "live",
  "paused",
  "completed",
  "stopped",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const PIXEL_EVENTS = ["page_view", "view_item", "add_to_cart", "begin_checkout", "purchase"] as const;
export type PixelEvent = (typeof PIXEL_EVENTS)[number];

/** Minimum eligible audience to launch — below this, holdout and lift are meaningless. */
export const MIN_AUDIENCE = 1000;

/** Learning period: performance alerts stay suggestions-only and are held back until this passes. */
export const LEARNING_HOURS = 72;
export const LEARNING_CONVERSIONS = 30;

/** Target ROAS used to derive a target CPA for alerting. */
export const TARGET_ROAS = 3;

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  scheduled: "Scheduled",
  live: "Live",
  paused: "Paused",
  completed: "Completed",
  stopped: "Stopped",
};
