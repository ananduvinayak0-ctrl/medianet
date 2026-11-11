"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Pause, Play, Rocket, ShieldCheck, Square } from "lucide-react";
import { api, ApiError, detailLines } from "@/lib/client";
import { Button, Callout } from "../ui";

interface Perms {
  canPause: boolean;
  canLaunch: boolean;
  canCreate: boolean;
  canApprove: boolean;
}

/** Campaign controls with confirmation built into the page (no browser dialogs). */
export function CampaignActions({ id, status, learning, perms }: { id: string; status: string; learning: boolean; perms: Perms }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"pause" | "stop" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; lines: string[] } | null>(null);

  async function run(action: string, body?: unknown) {
    setBusy(action);
    setError(null);
    try {
      const res = await api<{ id: string }>(`/api/campaigns/${id}/${action}`, { body: body ?? {}, idempotent: true });
      setConfirm(null);
      if (action === "clone") router.push(`/campaigns/${res.id}`);
      router.refresh();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Failed", lines: e instanceof ApiError ? detailLines(e.details) : [] });
    } finally {
      setBusy(null);
    }
  }

  const live = status === "live" || status === "scheduled";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "draft" && perms.canLaunch && (
          <Button onClick={() => run("launch")} disabled={busy !== null}>
            <Rocket className="size-4" aria-hidden /> {busy === "launch" ? "Launching…" : "Launch"}
          </Button>
        )}
        {status === "pending_approval" && perms.canApprove && (
          <Button onClick={() => run("approve")} disabled={busy !== null}>
            <ShieldCheck className="size-4" aria-hidden /> {busy === "approve" ? "Approving…" : "Approve & launch"}
          </Button>
        )}
        {live && perms.canPause && (
          <Button variant="warning" onClick={() => (learning ? setConfirm("pause") : run("pause"))} disabled={busy !== null}>
            <Pause className="size-4" aria-hidden /> {busy === "pause" ? "Pausing…" : "Pause"}
          </Button>
        )}
        {status === "paused" && perms.canLaunch && (
          <Button onClick={() => run("resume")} disabled={busy !== null}>
            <Play className="size-4" aria-hidden /> {busy === "resume" ? "Resuming…" : "Resume"}
          </Button>
        )}
        {["live", "paused", "scheduled", "pending_approval"].includes(status) && perms.canPause && (
          <Button variant="secondary" onClick={() => setConfirm("stop")} disabled={busy !== null}>
            <Square className="size-4" aria-hidden /> Stop
          </Button>
        )}
        {perms.canCreate && (
          <Button variant="secondary" onClick={() => run("clone")} disabled={busy !== null}>
            <Copy className="size-4" aria-hidden /> {busy === "clone" ? "Cloning…" : "Clone"}
          </Button>
        )}
      </div>

      {confirm === "pause" && (
        <Callout tone="amber" title="This campaign is still learning">
          <p>Early results swing a lot. Campaigns paused in the first 3 days often would have recovered. Pause anyway?</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="warning" onClick={() => run("pause", { note: "paused during learning period" })} disabled={busy !== null}>
              Yes, pause now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Keep running
            </Button>
          </div>
        </Callout>
      )}
      {confirm === "stop" && (
        <Callout tone="red" title="Stop permanently?">
          <p>A stopped campaign can&apos;t be resumed. Use Pause if you might restart it. You can still clone it later.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="danger" onClick={() => run("stop")} disabled={busy !== null}>
              Stop campaign
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </Callout>
      )}
      {error && (
        <Callout tone="red" title={error.message}>
          {error.lines.length > 0 && (
            <ul className="list-disc pl-5">
              {error.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </Callout>
      )}
    </div>
  );
}
