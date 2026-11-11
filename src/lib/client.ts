// Browser-side fetch helper for our API routes.

export class ApiError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; idempotent?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.idempotent) headers["idempotency-key"] = crypto.randomUUID();
  const res = await fetch(path, { method: opts.method ?? "POST", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, data.details);
  return data as T;
}

/** Flattens zod `flatten()` output or a string[] into readable lines. */
export function detailLines(details: unknown): string[] {
  if (Array.isArray(details)) return details.map(String);
  if (details && typeof details === "object") {
    const d = details as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
    return [...(d.formErrors ?? []), ...Object.entries(d.fieldErrors ?? {}).flatMap(([k, v]) => v.map((m) => `${k}: ${m}`))];
  }
  return [];
}
