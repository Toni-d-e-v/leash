"use client";
import { useEffect, useState } from "react";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { fmt, setLimitsIxs, usdc, type DemoConfig, type PolicyState } from "@/lib/leash";

const toBase = (n: number) => BigInt(Math.round(n * 1_000_000));

/**
 * Per-tx cap, daily cap and approval threshold, editable by the owner. Saving sends one transaction
 * (update_limits + set_approval_threshold); the agent's very next spend is checked against the new values.
 */
export function Limits({ cfg, policy, conn }: { cfg: DemoConfig; policy: PolicyState; conn: Connection }) {
  const wallet = useWallet();
  const [demoSigner, setDemoSigner] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [form, setForm] = useState({ perTx: "", daily: "", approval: "" });

  useEffect(() => {
    fetch("/api/owner").then((r) => r.json()).then((j) => setDemoSigner(!!j.available)).catch(() => setDemoSigner(false));
  }, []);

  const isOwnerWallet = !!wallet.publicKey && wallet.publicKey.toBase58() === policy.owner;
  const canEdit = isOwnerWallet || demoSigner;

  function startEdit() {
    setForm({
      perTx: String(usdc(policy.perTxCap)),
      daily: String(usdc(policy.dailyCap)),
      approval: String(usdc(policy.approvalThreshold)),
    });
    setMsg(null);
    setEditing(true);
  }

  const perTx = Number(form.perTx), daily = Number(form.daily), approval = Number(form.approval);
  const invalid =
    !(perTx > 0) ? "Per-transaction cap must be above 0." :
    !(daily > 0) ? "Daily cap must be above 0." :
    perTx > daily ? "Per-transaction cap can't be above the daily cap." :
    !(approval >= 0) ? "Approval threshold can't be negative." : null;

  async function save() {
    if (invalid) return;
    setBusy(true); setMsg(null);
    try {
      if (isOwnerWallet) {
        const tx = new Transaction().add(...setLimitsIxs(cfg.programId, wallet.publicKey!, new PublicKey(cfg.policy!.address), {
          perTxCap: toBase(perTx), dailyCap: toBase(daily), expiresAt: policy.expiresAt, approvalThreshold: toBase(approval),
        }));
        const sig = await wallet.sendTransaction(tx, conn);
        await conn.confirmTransaction(sig, "confirmed");
        const detail = `${perTx.toFixed(2)}/tx · ${daily.toFixed(2)}/day · approval ${approval === 0 ? "off" : `above ${approval.toFixed(2)}`}`;
        fetch(`${cfg.eventsUrl}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "owner", action: "limits", detail, signature: sig }) }).catch(() => {});
      } else {
        const r = await fetch("/api/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "limits", limits: { perTx, daily, approval } }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error ?? "failed");
      }
      setEditing(false);
      setMsg({ text: "Limits updated onchain. The agent's next spend is checked against them.", tone: "ok" });
    } catch (e: any) {
      setMsg({ text: e?.message ?? String(e), tone: "err" });
    } finally { setBusy(false); }
  }

  const rows: { key: keyof typeof form; label: string; value: string; hint?: string }[] = [
    { key: "perTx", label: "Per-transaction cap", value: `${fmt(usdc(policy.perTxCap))} USDC` },
    { key: "daily", label: "Daily cap", value: `${fmt(usdc(policy.dailyCap))} USDC` },
    {
      key: "approval", label: "Owner approval",
      value: policy.approvalThreshold > BigInt(0) ? `above ${fmt(usdc(policy.approvalThreshold))} USDC` : "off",
      hint: "0 = off",
    },
  ];

  return (
    <section className="rounded-2xl border border-line bg-panel p-5 sm:p-6" data-testid="limits">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Limits</h2>
        {!editing && canEdit && (
          <button onClick={startEdit} data-testid="edit-limits" className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-[#1c201e]">
            Edit limits
          </button>
        )}
      </div>

      {!editing ? (
        <dl className="mt-4 space-y-3 text-sm">
          {rows.map((r) => (
            <div key={r.key} className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">{r.label}</dt>
              <dd className="font-mono text-ink">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {rows.map((r) => (
            <label key={r.key} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted">{r.label}{r.hint && <span className="ml-2 text-[11px] text-dim">{r.hint}</span>}</span>
              <span className="flex items-center gap-2">
                <input
                  type="number" inputMode="decimal" step="0.01" min="0" value={form[r.key]} data-testid={`limit-${r.key}`}
                  onChange={(e) => setForm((f) => ({ ...f, [r.key]: e.target.value }))}
                  className="h-9 w-24 rounded-lg border border-line bg-panel-2 px-2.5 text-right font-mono text-sm text-ink outline-none focus:border-spend/60"
                />
                <span className="w-10 font-mono text-[11px] text-dim">USDC</span>
              </span>
            </label>
          ))}
          {invalid && <p className="text-xs text-warn">{invalid}</p>}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="submit" disabled={busy || !!invalid} data-testid="save-limits" className="h-10 rounded-xl bg-spend text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50">
              {busy ? "Saving…" : "Save onchain"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className="h-10 rounded-xl border border-line bg-panel-2 text-sm font-medium text-ink transition hover:bg-[#1c201e] disabled:opacity-50">
              Cancel
            </button>
          </div>
        </form>
      )}
      {msg && <p className={`mt-3 text-sm ${msg.tone === "ok" ? "text-spend" : "text-reject"}`}>{msg.text}</p>}
    </section>
  );
}
