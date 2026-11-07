"use client";
import { useEffect, useState } from "react";

/** Starts the demo agent from the dashboard (localhost only). Hidden when the runner isn't available. */
export function RunAgent({ big = false }: { big?: boolean }) {
  const [state, setState] = useState<{ available: boolean; running: boolean; mode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => fetch("/api/agent").then((r) => r.json()).then(setState).catch(() => setState(null));
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!state?.running) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [state?.running]);

  if (!state?.available) return null;

  async function run() {
    setError(null);
    const r = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) setError(j.error ?? "could not start the agent");
    refresh();
  }

  const label = state.running ? "Agent running…" : big ? "Run the agent" : "Run agent";
  return (
    <div className={big ? "mt-6 flex flex-col items-center gap-2" : "flex items-center"}>
      <button
        onClick={run} disabled={state.running} data-testid="run-agent"
        title={`Runs npm run agent (${state.mode} mode) with the agent's session key`}
        className={big
          ? "inline-flex h-12 items-center gap-2.5 rounded-xl bg-spend px-6 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
          : "inline-flex h-7 items-center gap-2 rounded-full border border-line bg-panel-2 px-3 font-sans text-xs font-medium text-ink transition hover:bg-[#1c201e] disabled:opacity-60"}
      >
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${big ? "bg-black/70" : "bg-spend"} ${state.running ? "pulse-dot" : ""}`} />
        {label}
      </button>
      {big && <span className="font-mono text-[11px] text-dim">{state.mode} mode · same as npm run agent</span>}
      {error && <span className="text-xs text-reject">{error}</span>}
    </div>
  );
}
