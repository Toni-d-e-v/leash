"use client";
import { useEffect, useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Connection } from "@solana/web3.js";
import { setPausedIx, type DemoConfig, type PolicyState } from "@/lib/leash";

/**
 * The kill switch. Signs with the connected wallet when it's the policy owner; otherwise uses the
 * local demo signer (a Next.js route that runs `npm run pause|unpause`, key stays server-side).
 */
export function KillSwitch({ cfg, policy, conn }: { cfg: DemoConfig; policy: PolicyState; conn: Connection }) {
  const wallet = useWallet();
  const [demoSigner, setDemoSigner] = useState(false);
  const [busy, setBusy] = useState<null | "pause" | "rotate">(null);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    fetch("/api/owner").then((r) => r.json()).then((j) => setDemoSigner(!!j.available)).catch(() => setDemoSigner(false));
  }, []);

  const isOwnerWallet = !!wallet.publicKey && wallet.publicKey.toBase58() === policy.owner;
  const canAct = isOwnerWallet || demoSigner;
  const via = isOwnerWallet ? "owner wallet" : demoSigner ? "local owner key" : null;

  async function toggle() {
    const next = !policy.paused;
    setBusy("pause"); setMsg(null);
    try {
      if (isOwnerWallet) {
        const tx = new Transaction().add(setPausedIx(cfg.programId, wallet.publicKey!, new PublicKey(cfg.policy!.address), next));
        const sig = await wallet.sendTransaction(tx, conn);
        await conn.confirmTransaction(sig, "confirmed");
        fetch(`${cfg.eventsUrl}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "owner", action: next ? "paused" : "unpaused", signature: sig }) }).catch(() => {});
      } else {
        const r = await fetch("/api/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: next ? "pause" : "unpause" }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error ?? "failed");
      }
      setMsg({ text: next ? "Agent paused. Every spend now fails onchain with PolicyPaused." : "Agent resumed.", tone: "ok" });
    } catch (e: any) {
      setMsg({ text: e?.message ?? String(e), tone: "err" });
    } finally { setBusy(null); }
  }

  async function rotate() {
    setBusy("rotate"); setMsg(null);
    try {
      const r = await fetch("/api/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rotate" }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "failed");
      setMsg({ text: "Agent key rotated. The old key is revoked.", tone: "ok" });
    } catch (e: any) {
      setMsg({ text: e?.message ?? String(e), tone: "err" });
    } finally { setBusy(null); }
  }

  const paused = policy.paused;
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Kill switch</h2>
        {via && <span className="font-mono text-[11px] text-dim">signs with {via}</span>}
      </div>
      <button
        onClick={toggle}
        disabled={!canAct || busy !== null}
        data-testid="kill-switch"
        className={`mt-4 flex h-20 w-full items-center justify-center gap-3 rounded-xl text-xl font-semibold tracking-tight transition
          disabled:cursor-not-allowed disabled:opacity-50
          ${paused
            ? "border border-spend/40 bg-spend/10 text-spend hover:bg-spend/15"
            : "bg-reject text-black hover:brightness-110 active:brightness-95"}`}
      >
        <span className={`inline-block h-3 w-3 rounded-full ${paused ? "bg-spend" : "bg-black/70"} ${busy === "pause" ? "pulse-dot" : ""}`} />
        {busy === "pause" ? (paused ? "Resuming…" : "Pausing…") : paused ? "Resume agent" : "Pause agent"}
      </button>
      <button
        onClick={rotate}
        disabled={!demoSigner || busy !== null}
        title={demoSigner ? "Generate a new agent key and revoke the current one" : "Run npm run rotate-agent"}
        className="mt-3 h-11 w-full rounded-xl border border-line bg-panel-2 text-sm font-medium text-ink transition hover:bg-[#1c201e] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === "rotate" ? "Rotating…" : "Rotate agent key"}
      </button>
      {!canAct && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Read-only. Connect the owner wallet, or run <code className="font-mono text-ink">npm run pause</code>.
        </p>
      )}
      {msg && <p className={`mt-3 text-sm ${msg.tone === "ok" ? "text-spend" : "text-reject"}`}>{msg.text}</p>}
    </section>
  );
}
