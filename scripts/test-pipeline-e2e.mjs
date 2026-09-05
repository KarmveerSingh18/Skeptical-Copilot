// scripts/test-pipeline-e2e.mjs
// End-to-end pipeline test: Parse → Critique → Synthesize → Confirm → Execute
// Uses a CLI confirm gate (user must type 'yes' to proceed).
// This places a REAL order on testnet if approved.
process.loadEnvFile(".env");

import { createInterface } from "node:readline";
import { getExchange } from "../src/sdk/client.js";
import { runPipeline } from "../src/sdk/pipeline.js";

const THESIS = process.argv[2] || "BTC won't hold above 80k in the next hour, willing to risk 50 bucks";

function hr(char = "─", len = 80) { return char.repeat(len); }

/**
 * CLI confirm gate — prints the full reasoning trail and asks the user to confirm.
 */
async function cliConfirmGate({ parsed, matched, critique, decision, bookState }) {
  console.log(`\n${hr("═")}`);
  console.log("  TRADE APPROVAL REQUIRED");
  console.log(hr("═"));

  console.log(`\n  Thesis:     "${parsed.rawThesis}"`);
  console.log(`  Asset:      ${parsed.asset} | Direction: ${parsed.direction}`);
  console.log(`  Market:     ${matched.symbol}`);
  console.log(`  Expiry:     ${matched.expiryDate} (${matched.remainingSec}s remaining)`);
  console.log(`  Last Price: ${matched.lastPriceFormatted || matched.lastPrice || "(none)"}`);

  console.log(`\n  CRITIC (severity ${critique.severityScore}/10):`);
  console.log(`  "${critique.counterArgument}"`);
  critique.riskFactors.forEach((r, i) => console.log(`    ${i + 1}. ${r}`));

  console.log(`\n  SYNTHESIS DECISION:`);
  console.log(`  Proceed: ${decision.proceed ? "YES" : "NO"} | Side: ${decision.side} | Confidence: ${(decision.statedConfidence * 100).toFixed(1)}%`);
  console.log(`  "${decision.reasoning}"`);

  console.log(`\n${hr("═")}`);
  console.log("  ⚠️  This will place a REAL market order on Somnia testnet.");
  console.log(hr("═"));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("\n  Type 'yes' to confirm trade, anything else to cancel: ", (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

async function main() {
  console.log(`\n${"═".repeat(80)}`);
  console.log("  SKEPTICAL COPILOT — FULL PIPELINE E2E TEST");
  console.log(`${"═".repeat(80)}\n`);
  console.log(`Thesis: "${THESIS}"\n`);

  const exchange = await getExchange();
  console.log("Exchange initialized.\n");

  const result = await runPipeline({
    thesisText: THESIS,
    exchange,
    confirmGate: cliConfirmGate,
    orderAmount: 1,
  });

  console.log(`\n${"═".repeat(80)}`);
  console.log("  PIPELINE RESULT");
  console.log(`${"═".repeat(80)}`);

  if (result.orderPlaced) {
    console.log("\n  ✅ ORDER PLACED AND FILLED");
    console.log(`  Trade Record #${result.tradeRecord.tradeNumber}:`);
    console.log(JSON.stringify(result.tradeRecord, null, 2));
  } else {
    console.log(`\n  🛑 NO ORDER PLACED`);
    console.log(`  Reason: ${result.declinedReason}`);
  }

  // Print latency breakdown
  const parseMs = result.stages.parse?.latencyMs ?? 0;
  const critiqueMs = result.stages.critique?.latencyMs ?? 0;
  const synthMs = result.stages.synthesis?.latencyMs ?? 0;
  console.log(`\n  Latency: parse=${parseMs}ms, critique=${critiqueMs}ms, synthesis=${synthMs}ms, total=${parseMs + critiqueMs + synthMs}ms`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
