/* One-off: add the custom-segmentation customer data to an EXISTING demo database without
 * re-seeding (keeps campaigns, wallet and history). Idempotent: rerunning rewrites the same values.
 *   npm run db:backfill-customers
 */
import { PrismaClient } from "@prisma/client";
import { refreshControlGroup } from "../src/lib/control-group";
import { deriveCustomerAttributes } from "../src/lib/customer-attributes";
import { createDemoAudiences } from "../src/lib/demo-audiences";
import { quarterKey } from "../src/lib/segment-defs";

const db = new PrismaClient();
const BATCH = 5000;

async function main() {
  const ws = await db.workspace.findFirst();
  if (!ws) throw new Error("No workspace. Run `npm run setup` first.");
  const now = ws.simNow;
  console.log(`Backfilling customer data for ${ws.name} (demo clock ${now.toISOString()})…`);

  let cursor: string | undefined;
  let done = 0;
  for (;;) {
    const page = await db.profile.findMany({
      where: { workspaceId: ws.id },
      select: { id: true, idHash: true, hasEmail: true, lastPurchaseAt: true, purchaseCount: true, totalSpendPaise: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (page.length === 0) break;
    const rows = page.map((p) => {
      const a = deriveCustomerAttributes(p, now, ws.aovPaise);
      return { ...a, id: p.id, categories: a.categories.join(",") };
    });
    // One statement per batch; the whole batch travels as a single JSON parameter.
    await db.$executeRaw`
      UPDATE "Profile" AS p SET
        "customerId" = v."customerId",
        "lastOnlinePurchaseAt" = v."lastOnlinePurchaseAt"::timestamp,
        "lastStorePurchaseAt" = v."lastStorePurchaseAt"::timestamp,
        "groupLastOnlinePurchaseAt" = v."groupLastOnlinePurchaseAt"::timestamp,
        "groupLastStorePurchaseAt" = v."groupLastStorePurchaseAt"::timestamp,
        "visits12m" = v."visits12m",
        "valueTier" = v."valueTier",
        "fullPriceShare" = v."fullPriceShare",
        "lifeStage" = v."lifeStage",
        "ageBand" = v."ageBand",
        "incomeBand" = v."incomeBand",
        "nationality" = v."nationality",
        "language" = v."language",
        "loyaltyTier" = v."loyaltyTier",
        "categories" = CASE WHEN v."categories" = '' THEN ARRAY[]::text[] ELSE string_to_array(v."categories", ',') END,
        "region" = v."region",
        "homeStore" = v."homeStore",
        "doNotContact" = v."doNotContact",
        "adsOptOut" = v."adsOptOut"
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS v(
        id text, "customerId" text,
        "lastOnlinePurchaseAt" text, "lastStorePurchaseAt" text, "groupLastOnlinePurchaseAt" text, "groupLastStorePurchaseAt" text,
        "visits12m" int, "valueTier" text, "fullPriceShare" float8, "lifeStage" text, "ageBand" text, "incomeBand" text,
        "nationality" text, "language" text, "loyaltyTier" text, "categories" text, "region" text, "homeStore" text,
        "doNotContact" boolean, "adsOptOut" boolean
      )
      WHERE p.id = v.id`;
    done += page.length;
    cursor = page[page.length - 1].id;
    process.stdout.write(`  ${done.toLocaleString("en-IN")} profiles\r`);
  }
  console.log(`  ${done.toLocaleString("en-IN")} profiles updated`);

  await db.workspace.update({ where: { id: ws.id }, data: { groupName: ws.groupName ?? "Kaapi Group" } });
  const n = await refreshControlGroup(db, ws, now);
  await db.workspace.update({ where: { id: ws.id }, data: { controlPeriodKey: quarterKey(now), controlRefreshedAt: now } });
  console.log(`  control group for ${quarterKey(now)} drawn over ${n.toLocaleString("en-IN")} profiles`);

  if ((await db.customPersona.count({ where: { workspaceId: ws.id } })) === 0) {
    const owner = await db.membership.findFirst({ where: { workspaceId: ws.id, role: "owner" } });
    const created = await createDemoAudiences(db, ws.id, owner!.userId, now);
    console.log(`  ${Object.keys(created).length} example custom audiences created`);
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
