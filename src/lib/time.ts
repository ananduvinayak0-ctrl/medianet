// IST-aware time helpers. Daily budgets reset at IST midnight.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
const IST_OFFSET = 330 * MINUTE; // UTC+05:30

/** YYYY-MM-DD for the IST calendar day containing `d`. */
export function istDayKey(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET).toISOString().slice(0, 10);
}

/** Hour of day (0–23) in IST. */
export function istHour(d: Date): number {
  return new Date(d.getTime() + IST_OFFSET).getUTCHours();
}

/** Start of the IST hour containing `d`. */
export function istHourStart(d: Date): Date {
  const shifted = d.getTime() + IST_OFFSET;
  return new Date(shifted - (shifted % HOUR) - IST_OFFSET);
}

/** Start (as a UTC instant) of the IST day containing `d`. */
export function istDayStart(d: Date): Date {
  const shifted = d.getTime() + IST_OFFSET;
  return new Date(shifted - (shifted % DAY) - IST_OFFSET);
}

export function addMs(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / DAY);
}
