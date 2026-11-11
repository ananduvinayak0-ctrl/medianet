import { route, readJson } from "@/lib/api";
import { topUpWallet } from "@/lib/campaign-service";
import { getSession } from "@/lib/session";

/** POST /api/wallet/topup { rupees } → { invoiceNo }  (Razorpay mocked; send Idempotency-Key) */
export const POST = route(async (req) => {
  const { rupees } = (await readJson(req)) as { rupees?: number };
  return topUpWallet(await getSession(), Number(rupees));
});
