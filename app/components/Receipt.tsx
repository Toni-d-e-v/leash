"use client";
import { useEffect, useState } from "react";
import type { Connection } from "@solana/web3.js";
import { explorer, short, type DemoConfig } from "@/lib/leash";

interface TxView { slot: number; err: string | null; fee: number; logs: string[]; time: number | null }

/** Onchain receipt fetched straight from the RPC: status + program logs. Works on localnet too. */
export function Receipt({ sig, cfg, conn, onClose }: { sig: string; cfg: DemoConfig; conn: Connection; onClose: () => void }) {
  const [tx, setTx] = useState<TxView | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stop = false;
    (async () => {
      for (let i = 0; i < 6 && !stop; i++) {
        const t = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
        if (t) {
          if (!stop) setTx({ slot: t.slot, err: t.meta?.err ? JSON.stringify(t.meta.err) : null, fee: t.meta?.fee ?? 0, logs: t.meta?.logMessages ?? [], time: t.blockTime ?? null });
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!stop) setMissing(true);
    })();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => { stop = true; window.removeEventListener("keydown", onKey); };
  }, [sig, conn, onClose]);

  const errorCode = tx?.logs.join("\n").match(/Error Code: (\w+)/)?.[1];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6" onClick={onClose} data-testid="receipt">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-t-2xl border border-line bg-panel sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Onchain receipt</p>
            <p className="mt-1 truncate font-mono text-sm text-ink">{short(sig, 10)}</p>
          </div>
          <button onClick={onClose} className="rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:text-ink">Close</button>
        </header>
        <div className="max-h-[calc(90vh-72px)] overflow-y-auto px-5 py-4">
          {!tx && !missing && <p className="text-sm text-muted">Fetching transaction from {cfg.cluster}…</p>}
          {missing && <p className="text-sm text-warn">Transaction not found on {cfg.cluster}.</p>}
          {tx && (
            <>
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-3 py-1 font-mono text-xs ${tx.err ? "bg-reject/15 text-reject" : "bg-spend/10 text-spend"}`}>
                  {tx.err ? `Failed${errorCode ? `: ${errorCode}` : ""}` : "Success"}
                </span>
                <span className="rounded-full bg-panel-2 px-3 py-1 font-mono text-xs text-muted">slot {tx.slot}</span>
                <span className="rounded-full bg-panel-2 px-3 py-1 font-mono text-xs text-muted">fee {tx.fee.toLocaleString()} lamports</span>
                <a href={explorer("tx", sig, cfg)} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-1 font-mono text-xs text-muted hover:text-ink">explorer ↗</a>
              </div>
              <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-muted">Program logs</p>
              <ol className="mt-2 space-y-1 rounded-xl border border-line bg-bg p-3 font-mono text-[11.5px] leading-relaxed">
                {tx.logs.map((l, i) => {
                  const hot = /Error Code|failed|AnchorError/.test(l);
                  const leash = l.includes(cfg.programId);
                  return (
                    <li key={i} className={`break-all ${hot ? "text-reject" : leash ? "text-ink" : "text-dim"}`}>{l}</li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
