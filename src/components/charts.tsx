"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Chart conventions (dataviz skill): one y-axis per chart (no dual axes; two measures → two
// charts), thin marks, rounded bar ends, recessive grid, hover tooltips, legend only for 2+ series.

const SERIES = ["var(--color-series-1)", "var(--color-series-2)", "var(--color-series-3)", "var(--color-series-4)", "var(--color-series-5)"];
const AXIS = { fontSize: 11, fill: "#64748b" };
const inrCompact = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${Math.round(v)}`);
const numCompact = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v * 10) / 10}`);
const dayLabel = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });

type Fmt = "inr" | "num";
const fmt = (f: Fmt) => (f === "inr" ? inrCompact : numCompact);

export function DailyBars({ data, dataKey, label, format = "num", series = 0, height = 200 }: { data: Record<string, number | string>[]; dataKey: string; label: string; format?: Fmt; series?: number; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={`${label} per day`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="#eef2f6" />
          <XAxis dataKey="day" tickFormatter={dayLabel} tick={AXIS} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} minTickGap={24} />
          <YAxis tickFormatter={fmt(format)} tick={AXIS} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.12)" }}
            labelFormatter={(d) => dayLabel(String(d))}
            formatter={(v: number) => [format === "inr" ? `₹${Math.round(v).toLocaleString("en-IN")}` : Math.round(v * 10) / 10, label]}
          />
          <Bar dataKey={dataKey} fill={SERIES[series]} radius={[4, 4, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HourlyLine({ data, dataKey, label, format = "num", series = 0, height = 180 }: { data: { t: number; [k: string]: number }[]; dataKey: string; label: string; format?: Fmt; series?: number; height?: number }) {
  const hourLabel = (t: number) => new Date(t).toLocaleString("en-IN", { hour: "2-digit", hour12: false, day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
  return (
    <div style={{ height }} role="img" aria-label={`${label} per hour`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#eef2f6" />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={hourLabel} tick={AXIS} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} minTickGap={40} />
          <YAxis tickFormatter={fmt(format)} tick={AXIS} tickLine={false} axisLine={false} width={48} />
          <Tooltip labelFormatter={(t) => `${hourLabel(Number(t))} IST`} formatter={(v: number) => [format === "inr" ? `₹${Math.round(v).toLocaleString("en-IN")}` : Math.round(v * 10) / 10, label]} />
          <Line type="monotone" dataKey={dataKey} stroke={SERIES[series]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MultiLine({ data, keys, labels, height = 240 }: { data: Record<string, number | string>[]; keys: string[]; labels: Record<string, string>; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label="Pixel events per day by type">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#eef2f6" />
          <XAxis dataKey="day" tickFormatter={dayLabel} tick={AXIS} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} minTickGap={24} />
          <YAxis tickFormatter={numCompact} tick={AXIS} tickLine={false} axisLine={false} width={48} />
          <Tooltip labelFormatter={(d) => dayLabel(String(d))} formatter={(v: number, k: string) => [Math.round(v).toLocaleString("en-IN"), labels[k] ?? k]} />
          <Legend formatter={(k: string) => <span className="text-xs text-slate-700">{labels[k] ?? k}</span>} iconType="plainline" />
          {keys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
