"use client";
import { useEffect, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { decodePolicy, parseSpendEvents, sha256Hex, type DemoConfig, type PolicyState } from "./leash";

export function useDemoConfig() {
  const [cfg, setCfg] = useState<DemoConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch(`/demo-config.json?t=${Date.now()}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("demo-config.json not found. Run npm run setup."))))
        .then((c: DemoConfig) => {
          if (stop) return;
          // Replace the object only when the policy changes (e.g. after reset-demo).
          setCfg((prev) => (prev && prev.policy?.address === c.policy?.address && prev.agent === c.agent ? prev : c));
          setError(null);
        })
        .catch((e) => !stop && setError(e.message));
    load();
    const t = setInterval(load, 3000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  return { cfg, error };
}

export function useConnection(cfg: DemoConfig | null) {
  const ref = useRef<Connection | null>(null);
  if (cfg && !ref.current) ref.current = new Connection(cfg.rpcUrl, "confirmed");
  return ref.current;
}

/** Policy + vault balance: live via onAccountChange, with 2s polling as a fallback. */
export function usePolicy(cfg: DemoConfig | null, conn: Connection | null) {
  const [policy, setPolicy] = useState<PolicyState | null>(null);
  const [vault, setVault] = useState<number | null>(null);
  const [missing, setMissing] = useState(false);
  const [live, setLive] = useState(false);
  const address = cfg?.policy?.address;
  const vaultAddr = cfg?.policy?.vault;

  useEffect(() => {
    if (!conn || !address || !vaultAddr) return;
    let stop = false;
    const pk = new PublicKey(address);
    const vk = new PublicKey(vaultAddr);
    const refresh = async () => {
      try {
        const [acc, bal] = await Promise.all([
          conn.getAccountInfo(pk),
          conn.getTokenAccountBalance(vk).catch(() => null),
        ]);
        if (stop) return;
        setMissing(!acc);
        setPolicy(acc ? decodePolicy(acc.data) : null);
        setVault(bal ? Number(bal.value.amount) / 1e6 : null);
      } catch { /* RPC hiccup: next poll */ }
    };
    refresh();
    const subs: number[] = [];
    try {
      subs.push(conn.onAccountChange(pk, (acc) => { setLive(true); setPolicy(decodePolicy(acc.data)); }, { commitment: "confirmed" }));
      subs.push(conn.onAccountChange(vk, () => { setLive(true); refresh(); }, { commitment: "confirmed" }));
    } catch { /* websocket unavailable */ }
    const poll = setInterval(refresh, 2000);
    return () => {
      stop = true;
      clearInterval(poll);
      subs.forEach((s) => conn.removeAccountChangeListener(s).catch(() => {}));
    };
  }, [conn, address, vaultAddr]);

  return { policy, vault, missing, live };
}

export interface FeedEvent {
  id: string;
  ts: number;
  type: "spend" | "rejection" | "agent" | "owner" | "run" | "approval";
  [k: string]: any;
}

/** Activity feed: history from GET /events, then live over SSE. */
export function useEvents(cfg: DemoConfig | null) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const url = cfg?.eventsUrl;
  useEffect(() => {
    if (!url) return;
    let es: EventSource | null = null;
    let stop = false;
    const seen = new Set<string>();
    const add = (ev: FeedEvent) => {
      if (seen.has(ev.id)) return;
      seen.add(ev.id);
      setEvents((prev) => [...prev, ev]);
    };
    fetch(`${url}/events`).then((r) => r.json()).then((list: FeedEvent[]) => !stop && list.forEach(add)).catch(() => {});
    const open = () => {
      es = new EventSource(`${url}/stream`);
      es.onopen = () => setConnected(true);
      es.onmessage = (m) => { try { add(JSON.parse(m.data)); } catch { /* ignore */ } };
      es.addEventListener("reset", () => { seen.clear(); setEvents([]); });
      es.onerror = () => setConnected(false); // EventSource reconnects on its own
    };
    open();
    return () => { stop = true; es?.close(); };
  }, [url]);
  return { events, connected };
}

export type Verification = "checking" | "verified" | "mismatch" | "unavailable";

/** Re-hash the reason text and compare it with reason_hash in the onchain SpendEvent. */
export function useReasonVerification(conn: Connection | null, events: FeedEvent[]) {
  const [status, setStatus] = useState<Record<string, Verification>>({});
  const started = useRef(new Set<string>());
  useEffect(() => {
    if (!conn) return;
    for (const ev of events) {
      if (ev.type !== "spend" || !ev.signature || started.current.has(ev.id)) continue;
      started.current.add(ev.id);
      setStatus((s) => ({ ...s, [ev.id]: "checking" }));
      (async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const tx = await conn.getTransaction(ev.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
          if (tx?.meta?.logMessages) {
            const onchain = parseSpendEvents(tx.meta.logMessages).find((e) => e.requestId === ev.requestId) ?? parseSpendEvents(tx.meta.logMessages)[0];
            const local = await sha256Hex(ev.reason ?? "");
            setStatus((s) => ({ ...s, [ev.id]: onchain && onchain.reasonHash === local ? "verified" : "mismatch" }));
            return;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        setStatus((s) => ({ ...s, [ev.id]: "unavailable" }));
      })();
    }
  }, [conn, events]);
  return status;
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}
