// Activity feed: POST /events appends an event, GET /stream pushes them over SSE, GET /events returns history.
// Persisted to agent/events.jsonl so the dashboard can rebuild the feed after a reload.
import express from "express";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EVENTS_PORT, ROOT } from "../shared/config.js";

const FILE = join(ROOT, "agent", "events.jsonl");
const clients = new Set<express.Response>();

const load = () =>
  existsSync(FILE)
    ? readFileSync(FILE, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } })
    : [];

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  next();
});

app.get("/events", (_req, res) => res.json(load()));

app.post("/events", (req, res) => {
  const ev = { id: randomUUID(), ts: Date.now(), ...req.body };
  appendFileSync(FILE, JSON.stringify(ev) + "\n");
  for (const c of clients) c.write(`data: ${JSON.stringify(ev)}\n\n`);
  res.json(ev);
});

// Reset marker: clears history (used by reset-demo when the server is running).
app.post("/events/reset", (_req, res) => {
  writeFileSync(FILE, "");
  for (const c of clients) c.write(`event: reset\ndata: {}\n\n`);
  res.json({ ok: true });
});

app.get("/stream", (req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(": connected\n\n");
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.on("close", () => { clearInterval(ping); clients.delete(res); });
});

app.listen(EVENTS_PORT, () => console.log(`Leash event feed on http://localhost:${EVENTS_PORT} (SSE /stream)`));
