"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Budget } from "@/components/Budget";
import { KillSwitch } from "@/components/KillSwitch";
import { Feed } from "@/components/Feed";
import { useConnection, useDemoConfig, useEvents, useNow, usePolicy, useReasonVerification } from "@/lib/hooks";
import { explorer, fmt, short, type DemoConfig, type PolicyState } from "@/lib/leash";

// The wallet button touches window; render it client-side only.
const WalletButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), { ssr: false });

export default function Home() {
  const { cfg, error } = useDemoConfig();
  const conn = useConnection(cfg);
  const { policy, vault, missing } = usePolicy(cfg, conn);
  const { events, connected } = useEvents(cfg);
  const verify = useReasonVerification(conn, events);
  const now = useNow();
  const flash = useFlashOnRejection(events.filter((e) => e.type === "rejection").length);

  const status = !policy ? null : policy.paused ? "paused" : policy.expiresAt !== 0 && now / 1000 >= policy.expiresAt ? "expired" : "active";

  return (
    <main className="relative z-10 mx-auto w-full max-w-[1400px] px-4 pb-16 pt-5 sm:px-8 sm:pt-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Leash</h1>
            <p className="text-xs text-muted">Onchain spending limits for AI agents</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cfg && <span className="rounded-full border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted">{cfg.cluster}</span>}
          {status && <StatusPill status={status} />}
          <WalletButton />
        </div>
      </header>

      {error && <Notice>{error}</Notice>}
      {cfg && !cfg.policy && <Notice>No demo policy yet. Run <code className="font-mono">npm run reset-demo</code>.</Notice>}
      {cfg?.policy && missing && <Notice>Policy {short(cfg.policy.address)} not found on {cfg.cluster}. Is the validator running?</Notice>}

      {cfg && policy && conn && (
        <div className="mt-6 grid gap-5 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
          <div className="flex flex-col gap-5">
            <div className={flash ? "flash-red rounded-2xl" : ""}>
              <Budget policy={policy} vault={vault} now={now} />
            </div>
            <KillSwitch cfg={cfg} policy={policy} conn={conn} />
            <PolicyCard cfg={cfg} policy={policy} />
          </div>
          <Feed cfg={cfg} conn={conn} events={events} verify={verify} connected={connected} />
        </div>
      )}
    </main>
  );
}

function useFlashOnRejection(count: number) {
  const prev = useRef(count);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (count > prev.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1900);
      prev.current = count;
      return () => clearTimeout(t);
    }
    prev.current = count;
  }, [count]);
  return flash;
}

function StatusPill({ status }: { status: "active" | "paused" | "expired" }) {
  const s = {
    active: "border-spend/40 bg-spend/10 text-spend",
    paused: "border-reject/50 bg-reject/15 text-reject",
    expired: "border-warn/40 bg-warn/10 text-warn",
  }[status];
  return (
    <span data-testid="status" className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${s}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${status === "active" ? "pulse-dot" : ""}`} />
      {status}
    </span>
  );
}

function PolicyCard({ cfg, policy }: { cfg: DemoConfig; policy: PolicyState }) {
  const name = (addr: string) => cfg.services.find((s) => s.recipient === addr)?.name;
  const expires = policy.expiresAt === 0 ? "never" : new Date(policy.expiresAt * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 sm:p-6">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Policy rules · enforced by the program</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <Line k="Policy"><Addr cfg={cfg} a={cfg.policy!.address} /></Line>
        <Line k="Agent key"><Addr cfg={cfg} a={policy.agent} /></Line>
        <Line k="Owner"><Addr cfg={cfg} a={policy.owner} /></Line>
        <Line k="Expires">{expires}</Line>
        <Line k="Allowlist">
          <ul className="flex flex-wrap justify-end gap-1.5">
            {policy.allowlist.map((a) => (
              <li key={a} className="rounded-full bg-panel-2 px-2.5 py-1 font-mono text-[11px] text-ink">{name(a) ?? short(a)}</li>
            ))}
          </ul>
        </Line>
      </dl>
      <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-muted">
        Every rule above is checked inside the Leash program on each <code className="font-mono text-ink">spend</code>.
        The agent holds only a session key, so a fooled model can ask for anything and still get nothing past these limits.
        Prices: {cfg.services.map((s) => `${s.name} ${fmt(s.price)}`).join(" · ")}.
      </p>
    </section>
  );
}

function Line({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 text-right text-ink">{children}</dd>
    </div>
  );
}

function Addr({ cfg, a }: { cfg: DemoConfig; a: string }) {
  return <a className="font-mono text-[13px] text-ink underline decoration-line underline-offset-4 hover:decoration-muted" href={explorer("address", a, cfg)} target="_blank" rel="noreferrer">{short(a, 6)}</a>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">{children}</div>;
}

function Logo() {
  // A leash: a loop with a short lead.
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="35" height="35" rx="10" fill="#111312" stroke="#222724" />
      <circle cx="14" cy="15" r="6" stroke="#b8f53d" strokeWidth="2.5" />
      <path d="M18.5 19.5 L27 28" stroke="#b8f53d" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
