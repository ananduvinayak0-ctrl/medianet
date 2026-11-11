import type { Objective, PersonaKey } from "./domain";

// Retention Playbooks (decision D3): persona + template + frequency cap + duration pre-bundled.
// One click to start; every field remains editable in the wizard ("ease AND control").

export interface Playbook {
  key: string;
  name: string;
  summary: string;
  objective: Objective;
  personaKey: PersonaKey;
  templateKey: string;
  freqCapDay: number;
  freqCapWeek: number;
  durationDays: number;
  offerCode?: string;
}

export const PLAYBOOKS: Playbook[] = [
  {
    key: "recover-carts",
    name: "Recover abandoned carts",
    summary: "Show shoppers the exact product they left behind, for 14 days.",
    objective: "retarget",
    personaKey: "cart_abandoners",
    templateKey: "dpa-cart",
    freqCapDay: 4,
    freqCapWeek: 12,
    durationDays: 14,
  },
  {
    key: "nudge-browsers",
    name: "Nudge repeat viewers",
    summary: "Remind undecided shoppers of products they viewed more than once.",
    objective: "retarget",
    personaKey: "repeat_browsers",
    templateKey: "dpa-viewed",
    freqCapDay: 3,
    freqCapWeek: 10,
    durationDays: 14,
  },
  {
    key: "win-back",
    name: "Win back lapsed buyers",
    summary: "Bring back customers who haven't ordered in 31–90 days, with an offer.",
    objective: "reactivate",
    personaKey: "lapsed_buyers",
    templateKey: "winback-offer",
    freqCapDay: 2,
    freqCapWeek: 6,
    durationDays: 21,
    offerCode: "COMEBACK15",
  },
  {
    key: "cross-sell",
    name: "Cross-sell to recent buyers",
    summary: "Suggest complementary products within 30 days of a purchase.",
    objective: "reactivate",
    personaKey: "recent_buyers",
    templateKey: "cross-sell",
    freqCapDay: 2,
    freqCapWeek: 6,
    durationDays: 14,
  },
  {
    key: "vip",
    name: "VIP early access",
    summary: "Give your top 20% of customers first pick on a launch.",
    objective: "reactivate",
    personaKey: "high_value",
    templateKey: "vip-early-access",
    freqCapDay: 2,
    freqCapWeek: 5,
    durationDays: 7,
  },
];

export function getPlaybook(key: string | undefined): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.key === key);
}
