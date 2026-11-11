import { NextResponse } from "next/server";
import { db } from "./db";
import { AppError } from "./errors";
import { ForbiddenError } from "./rbac";
import { AdapterError } from "./channels/adapter";

// Thin route-handler wrapper: consistent JSON errors + optional idempotency.

export type RouteCtx<P = Record<string, string>> = { params: Promise<P> };

export function route<P = Record<string, string>>(fn: (req: Request, ctx: RouteCtx<P>) => Promise<unknown>) {
  return async (req: Request, ctx: RouteCtx<P>) => {
    try {
      const rawKey = req.headers.get("idempotency-key");
      if (rawKey && req.method !== "GET") {
        // Scope keys to method + path so a key reused on another endpoint never replays a foreign response.
        const key = `${req.method} ${new URL(req.url).pathname} ${rawKey}`;
        const hit = await db.idempotencyKey.findUnique({ where: { key } });
        if (hit) return NextResponse.json(JSON.parse(hit.response), { headers: { "idempotent-replay": "true" } });
        const data = await fn(req, ctx);
        await db.idempotencyKey.create({ data: { key, response: JSON.stringify(data ?? null) } }).catch(() => undefined);
        return NextResponse.json(data ?? null);
      }
      return NextResponse.json((await fn(req, ctx)) ?? null);
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
      if (e instanceof ForbiddenError || e instanceof AdapterError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: "Something went wrong. Nothing was changed. Please try again." }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
