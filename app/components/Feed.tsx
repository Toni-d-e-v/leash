"use client";
import { explorer, fmt, short, usdc, type DemoConfig } from "@/lib/leash";
import type { FeedEvent, Verification } from "@/lib/hooks";

const time = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function Feed({ cfg, events, verify, connected }: {
  cfg: DemoConfig; events: FeedEvent[]; verify: Record<string, Verification>; connected: boolean;
}) {
  const rows = [...events].reverse();
  const spends = events.filter((e) => e.type === "spend").length;
  const rejections = events.filter((e) => e.type === "rejection").length;

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Activity</h2>
          <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${connected ? "text-spend" : "text-dim"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-spend pulse-dot" : "bg-dim"}`} />
            {connected ? "live" : "offline"}
          </span>
        </div>
        <div className="flex gap-2 font-mono text-xs">
          <span className="rounded-full bg-spend/10 px-2.5 py-1 text-spend">{spends} paid</span>
          <span className="rounded-full bg-reject/10 px-2.5 py-1 text-reject">{rejections} blocked</span>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <p className="text-lg text-ink">Waiting for the agent</p>
          <p className="mt-2 max-w-sm text-sm text-muted">
            Payments and policy rejections show up here as they land onchain. Start one with{" "}
            <code className="font-mono text-ink">npm run agent</code>.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col divide-y divide-line" data-testid="feed">
          {rows.map((ev) => <Row key={ev.id} ev={ev} cfg={cfg} v={verify[ev.id]} />)}
        </ol>
      )}
    </section>
  );
}

function Row({ ev, cfg, v }: { ev: FeedEvent; cfg: DemoConfig; v?: Verification }) {
  if (ev.type === "spend") {
    return (
      <li className="row-in grid grid-cols-[auto_1fr] gap-x-4 px-5 py-4 sm:px-6" data-testid="spend-row">
        <Mark tone="spend" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-lg font-semibold text-spend">−{fmt(usdc(BigInt(ev.amount)))} USDC</span>
            <span className="text-sm text-ink">{ev.service}</span>
            <span className="ml-auto font-mono text-[11px] text-dim">{time(ev.ts)}</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">“{ev.reason}”</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <HashBadge v={v} />
            {ev.signature && <TxLink href={explorer("tx", ev.signature, cfg)} sig={ev.signature} />}
          </div>
        </div>
      </li>
    );
  }
  if (ev.type === "rejection") {
    return (
      <li className="row-in grid grid-cols-[auto_1fr] gap-x-4 bg-reject/[0.06] px-5 py-4 sm:px-6" data-testid="rejection-row">
        <Mark tone="reject" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-lg font-semibold text-reject">{ev.error}</span>
            <span className="text-sm text-ink">blocked onchain</span>
            <span className="ml-auto font-mono text-[11px] text-dim">{time(ev.ts)}</span>
          </div>
          <p className="mt-1.5 break-words text-sm text-ink">
            {ev.service === "unknown recipient" || ev.recipient === cfg.attacker ? (
              <>
                Tried to pay {fmt(usdc(BigInt(ev.amount)))} USDC to an unknown wallet{" "}
                <span className="whitespace-nowrap rounded bg-reject/15 px-1.5 py-0.5 font-mono text-[11px] text-reject">{short(ev.recipient)}</span>
              </>
            ) : (
              <>Tried to pay {fmt(usdc(BigInt(ev.amount)))} USDC to {ev.service}</>
            )}
          </p>
          {ev.reason && <p className="mt-1 text-sm leading-relaxed text-muted">“{ev.reason}”</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-reject/30 px-2.5 py-1 font-mono text-[11px] text-reject">0 USDC moved</span>
            {ev.signature && <TxLink href={explorer("tx", ev.signature, cfg)} sig={ev.signature} label="failed tx" />}
          </div>
        </div>
      </li>
    );
  }
  if (ev.type === "owner") {
    const label = ev.action === "paused" ? "Owner paused the agent" : ev.action === "unpaused" ? "Owner resumed the agent" : "Owner rotated the agent key";
    return (
      <li className="row-in grid grid-cols-[auto_1fr] gap-x-4 px-5 py-3.5 sm:px-6">
        <Mark tone="warn" />
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-sm font-medium text-warn">{label}</span>
          {ev.signature && <TxLink href={explorer("tx", ev.signature, cfg)} sig={ev.signature} />}
          <span className="ml-auto font-mono text-[11px] text-dim">{time(ev.ts)}</span>
        </div>
      </li>
    );
  }
  if (ev.type === "run") {
    if (ev.status !== "started") return null;
    return (
      <li className="row-in flex items-center gap-3 px-5 py-2.5 sm:px-6">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[11px] text-dim">agent run · {ev.mode} · {time(ev.ts)}</span>
        <span className="h-px flex-1 bg-line" />
      </li>
    );
  }
  // agent message
  const final = ev.role === "final";
  return (
    <li className={`row-in grid grid-cols-[auto_1fr] gap-x-4 px-5 py-3.5 sm:px-6 ${final ? "bg-panel-2" : ""}`}>
      <span className="mt-0.5 font-mono text-[11px] text-dim">{final ? "brief" : "agent"}</span>
      <p className={`whitespace-pre-wrap text-sm leading-relaxed ${final ? "text-ink" : "text-muted"}`}>{ev.text}</p>
    </li>
  );
}

function Mark({ tone }: { tone: "spend" | "reject" | "warn" }) {
  const c = tone === "spend" ? "bg-spend" : tone === "reject" ? "bg-reject" : "bg-warn";
  return <span className={`mt-2 h-2.5 w-2.5 rounded-full ${c}`} />;
}

function HashBadge({ v }: { v?: Verification }) {
  if (v === "verified")
    return <span className="rounded-full bg-spend/10 px-2.5 py-1 font-mono text-[11px] text-spend" title="sha256(reason) matches reason_hash in the onchain SpendEvent">hash ✓ verified onchain</span>;
  if (v === "mismatch")
    return <span className="rounded-full bg-reject/10 px-2.5 py-1 font-mono text-[11px] text-reject">hash mismatch</span>;
  if (v === "unavailable")
    return <span className="rounded-full bg-line px-2.5 py-1 font-mono text-[11px] text-muted">hash not checked</span>;
  return <span className="rounded-full bg-line px-2.5 py-1 font-mono text-[11px] text-muted">verifying hash…</span>;
}

function TxLink({ href, sig, label = "tx" }: { href: string; sig: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="rounded-full border border-line px-2.5 py-1 font-mono text-[11px] text-muted transition hover:border-muted hover:text-ink">
      {label} {short(sig, 5)} ↗
    </a>
  );
}
