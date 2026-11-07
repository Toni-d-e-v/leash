"use client";
import { fmt, usdc, type PolicyState } from "@/lib/leash";

function countdown(secs: number) {
  if (secs <= 0) return "00:00:00";
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
  return [h, m, s].map((x) => String(x).padStart(2, "0")).join(":");
}

/** Big budget meter: the daily cap drawn as a chain of links, one per 0.05 USDC. */
export function Budget({ policy, vault, now }: { policy: PolicyState; vault: number | null; now: number }) {
  const nowS = Math.floor(now / 1000);
  const rolled = nowS - policy.windowStart >= 86_400;
  const spent = rolled ? 0 : usdc(policy.spentInWindow);
  const cap = usdc(policy.dailyCap);
  const perTx = usdc(policy.perTxCap);
  const pct = cap > 0 ? Math.min(1, spent / cap) : 0;
  const links = Math.max(1, Math.min(40, Math.round(cap / 0.05)));
  const filled = Math.round(pct * links);
  const resetIn = rolled ? 86_400 : policy.windowStart + 86_400 - nowS;

  return (
    <section className="rounded-2xl border border-line bg-panel p-5 sm:p-7">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Spent today</h2>
        <span className="font-mono text-xs text-muted">{Math.round(pct * 100)}% of daily cap</span>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-6xl font-semibold tabular-nums tracking-tight text-ink sm:text-7xl" data-testid="spent">
          {fmt(spent)}
        </span>
        <span className="font-mono text-xl text-muted sm:text-2xl">/ {fmt(cap)} USDC</span>
      </div>

      <div className="mt-6 flex gap-[3px]" aria-label={`${fmt(spent)} of ${fmt(cap)} USDC spent`}>
        {Array.from({ length: links }, (_, i) => (
          <div
            key={i}
            className={`h-3 flex-1 rounded-full transition-colors duration-500 ${i < filled ? (pct >= 1 ? "bg-reject" : "bg-spend") : "bg-line"}`}
          />
        ))}
      </div>

      <dl className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        <Stat label="Per-tx cap" value={fmt(perTx)} unit="USDC" />
        <Stat label="Remaining" value={fmt(Math.max(0, cap - spent))} unit="USDC" />
        <Stat label="Resets in" value={countdown(resetIn)} />
        <Stat label="Vault" value={vault === null ? "…" : fmt(vault)} unit="USDC" />
      </dl>
      <p className="mt-4 font-mono text-xs text-dim">Lifetime spent {fmt(usdc(policy.totalSpent))} USDC</p>
    </section>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="bg-panel-2 px-4 py-3.5">
      <dt className="text-[10px] uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-lg tabular-nums text-ink">
        {value} {unit && <span className="text-xs text-muted">{unit}</span>}
      </dd>
    </div>
  );
}
