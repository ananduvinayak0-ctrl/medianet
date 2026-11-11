// INR + IST formatting helpers. Money is integer paise everywhere.

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹1,50,000 — Indian digit grouping. */
export function formatINR(paise: number, opts: { precise?: boolean } = {}): string {
  return (opts.precise ? inr2 : inr0).format(paise / 100);
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

export function formatNum(n: number): string {
  return num.format(Math.round(n));
}

export function formatPct(ratio: number, digits = 2): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatRatio(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  return `${x.toFixed(digits)}×`;
}

const dt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const d = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

export function formatDateTime(date: Date | string): string {
  return `${dt.format(new Date(date))} IST`;
}

export function formatDate(date: Date | string): string {
  return d.format(new Date(date));
}
