// Indian D2C peak-season calendar. During peaks, clicks cost more and convert better,
// alert thresholds loosen, and the wizard reminds users to raise caps ahead of time.

export interface PeakSeason {
  key: string;
  name: string;
  start: string; // YYYY-MM-DD (IST, inclusive)
  end: string;
  cpcFactor: number;
  cvrFactor: number;
}

export const PEAK_SEASONS: PeakSeason[] = [
  { key: "diwali-2026", name: "Diwali festive sale", start: "2026-10-25", end: "2026-11-10", cpcFactor: 1.4, cvrFactor: 1.25 },
  { key: "bfcm-2026", name: "Black Friday / Cyber Monday", start: "2026-11-25", end: "2026-12-01", cpcFactor: 1.3, cvrFactor: 1.2 },
  { key: "eoss-2026", name: "End of Season Sale", start: "2026-12-20", end: "2027-01-05", cpcFactor: 1.25, cvrFactor: 1.15 },
  { key: "republic-2027", name: "Republic Day sale", start: "2027-01-20", end: "2027-01-27", cpcFactor: 1.2, cvrFactor: 1.1 },
  { key: "valentine-2027", name: "Valentine's week", start: "2027-02-07", end: "2027-02-14", cpcFactor: 1.2, cvrFactor: 1.15 },
];

export function peakForDay(dayKey: string): PeakSeason | undefined {
  return PEAK_SEASONS.find((p) => dayKey >= p.start && dayKey <= p.end);
}

/** Peaks overlapping [startKey, endKey]. */
export function peaksOverlapping(startKey: string, endKey: string): PeakSeason[] {
  return PEAK_SEASONS.filter((p) => p.start <= endKey && p.end >= startKey);
}

export function nextPeak(fromKey: string): PeakSeason | undefined {
  return PEAK_SEASONS.find((p) => p.end >= fromKey);
}
