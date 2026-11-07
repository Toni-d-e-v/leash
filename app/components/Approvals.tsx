"use client";
import { useState } from "react";
import { Transaction, type Connection } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { fmt, resolveSpendIx, short, usdc, type DemoConfig, type PolicyState } from "@/lib/leash";
import type { FeedEvent } from "@/lib/hooks";

/** Requests that are still waiting: "requested" with no later resolution for the same pending account. */
export function pendingApprovals(events: FeedEvent[]) {
  const resolved = new Set(
    events.filter((e) => (e.type === "approval" && e.status !== "requested") || (e.type === "owner" && (e.action === "approved" || e.action === "rejected")))
      .map((e) => e.pending),
  );
  return events.filter((e) => e.type === "approval" && e.status === "requested" && !resolved.has(e.pending));
}

export function Approvals({ cfg, policy, conn, events }: { cfg: DemoConfig; policy: PolicyState; conn: Connection; events: FeedEvent[] }) {
  const wallet = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waiting = pendingApprovals(events);
  if (waiting.length === 0) return null;
  const isOwnerWallet = !!wallet.publicKey && wallet.publicKey.toBase58() === policy.owner;

  async function resolve(ev: FeedEvent, approve: boolean) {
    setBusy(ev.pending + approve); setError(null);
    try {
      if (isOwnerWallet) {
        const tx = new Transaction().add(resolveSpendIx(cfg, wallet.publicKey!, approve, { pending: ev.pending, requester: ev.requester, recipient: ev.recipient }));
        const sig = await wallet.sendTransaction(tx, conn);
        await conn.confirmTransaction(sig, "confirmed");
        fetch(`${cfg.eventsUrl}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "owner", action: approve ? "approved" : "rejected", signature: sig, pending: ev.pending }) }).catch(() => {});
      } else {
        const r = await fetch("/api/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: approve ? "approve" : "reject", pending: ev.pending }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error ?? "failed");
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setBusy(null); }
  }

  return (
    <section className="row-in rounded-2xl border border-warn/40 bg-warn/[0.07] p-5 sm:p-6" data-testid="approvals">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-warn">Needs your approval</h2>
        <span className="font-mono text-[11px] text-muted">above {fmt(usdc(policy.approvalThreshold))} USDC</span>
      </div>
      <ul className="mt-3 space-y-4">
        {waiting.map((ev) => (
          <li key={ev.pending}>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-mono text-2xl font-semibold text-ink">{fmt(usdc(BigInt(ev.amount)))} USDC</span>
              <span className="text-sm text-ink">to {ev.service}</span>
              <span className="font-mono text-[11px] text-dim">{short(ev.pending)}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted">“{ev.reason}”</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => resolve(ev, true)} disabled={busy !== null} data-testid="approve"
                className="h-11 rounded-xl bg-spend text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
              >{busy === ev.pending + true ? "Approving…" : "Approve"}</button>
              <button
                onClick={() => resolve(ev, false)} disabled={busy !== null} data-testid="reject"
                className="h-11 rounded-xl border border-line bg-panel-2 text-sm font-medium text-ink transition hover:bg-[#1c201e] disabled:opacity-50"
              >{busy === ev.pending + false ? "Rejecting…" : "Reject"}</button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm text-reject">{error}</p>}
    </section>
  );
}
