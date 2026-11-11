import type { PrismaClient } from "@prisma/client";

export interface WalletSummary {
  balancePaise: number; // sum of ledger entries (posted)
  inFlightPaise: number; // delivered but not yet reported by the channel (spend lag)
  availablePaise: number; // what new delivery may use = balance − in-flight
  committedPaise: number; // remaining lifetime budgets of live/scheduled campaigns
  dailyBurnPaise: number; // sum of daily budgets of live campaigns
}

export async function walletSummary(db: PrismaClient, workspaceId: string): Promise<WalletSummary> {
  const [bal, inflight, active] = await Promise.all([
    db.ledgerEntry.aggregate({ where: { workspaceId }, _sum: { amountPaise: true } }),
    db.metricBucket.aggregate({ where: { spendPosted: false, campaign: { workspaceId } }, _sum: { spendPaise: true } }),
    db.campaign.findMany({
      where: { workspaceId, status: { in: ["live", "scheduled"] } },
      select: { status: true, dailyBudgetPaise: true, lifetimeBudgetPaise: true, totalSpendPaise: true },
    }),
  ]);
  const balancePaise = bal._sum.amountPaise ?? 0;
  const inFlightPaise = inflight._sum.spendPaise ?? 0;
  return {
    balancePaise,
    inFlightPaise,
    availablePaise: balancePaise - inFlightPaise,
    committedPaise: active.reduce((a, c) => a + Math.max(0, c.lifetimeBudgetPaise - c.totalSpendPaise), 0),
    dailyBurnPaise: active.filter((c) => c.status === "live").reduce((a, c) => a + c.dailyBudgetPaise, 0),
  };
}

export async function nextInvoiceNo(db: PrismaClient, workspaceId: string, at: Date): Promise<string> {
  const n = await db.ledgerEntry.count({ where: { workspaceId, type: "topup" } });
  return `INV-${at.getUTCFullYear()}-${String(n + 1).padStart(5, "0")}`;
}
