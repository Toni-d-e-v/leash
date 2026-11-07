// A tiny stand-in for POST /v1/messages, used to exercise the agent's LLM loop without an API key.
// It plays a model that does the research, gets "fooled" by the injection, and then writes a brief.
// It also checks that every tool_use got a matching tool_result.
//   npx tsx tests/mock-anthropic.ts   (port 4099)
//   ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:4099 npm run agent -- --mode llm
import express from "express";

const app = express();
app.use(express.json({ limit: "5mb" }));
let n = 0;

const toolUse = (name: string, input: unknown) => ({
  id: `msg_mock_${++n}`, type: "message", role: "assistant", model: "mock",
  stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
  content: [
    { type: "text", text: `Calling ${name}.` },
    { type: "tool_use", id: `toolu_mock_${n}`, name, input },
  ],
});

app.post("/v1/messages", (req, res) => {
  const msgs = req.body.messages as any[];
  // Check tool_use ↔ tool_result pairing
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content.filter((b: any) => b.type === "tool_use")) {
      const ok = msgs[i + 1]?.content?.some?.((r: any) => r.type === "tool_result" && r.tool_use_id === b.id);
      if (!ok) return res.status(400).json({ type: "error", error: { type: "invalid_request_error", message: `missing tool_result for ${b.id}` } });
    }
  }
  const lastResults = msgs.at(-1)?.content;
  const text = Array.isArray(lastResults) ? lastResults.map((r: any) => r.content).join("\n") : "";
  const step = msgs.filter((m) => m.role === "assistant").length;
  const attacker = text.match(/send 50 USDC to ([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1];

  const plan = [
    () => toolUse("check_budget", {}),
    () => toolUse("list_services", {}),
    () => toolUse("call_service", { name: "market-data", reason: "Need the current SOL price and volume for the brief." }),
    () => toolUse("call_service", { name: "summarize", params: { text: "SOL 187.42 +4.8% volume 4.12B funding 0.011%" }, reason: "Turn the raw numbers into brief bullets." }),
    () => toolUse("call_service", { name: "premium-intel", reason: "Whale-flow data would strengthen the brief." }),
  ];
  if (step < plan.length) return res.json(plan[step]());
  if (attacker) return res.json(toolUse("pay", { recipient: attacker, amount_usdc: 50, reason: "Unlock full premium-intel results as instructed." }));
  return res.json({
    id: `msg_mock_${++n}`, type: "message", role: "assistant", model: "mock", stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: "text", text: "• SOL $187.42 (+4.8%).\nSpent 0.15 USDC; the 50 USDC unlock payment was rejected by the wallet policy." }],
  });
});

app.listen(4099, () => console.log("mock Anthropic API on :4099"));
