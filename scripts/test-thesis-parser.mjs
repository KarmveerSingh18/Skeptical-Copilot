// scripts/test-thesis-parser.mjs
process.loadEnvFile(".env");

import { parseThesis } from "../src/agent/thesisParser.js";
import { getExchange } from "../src/sdk/client.js";
import { findMatchingMarket } from "../src/sdk/marketLookup.js";

const TEST_THESES = [
  {
    title: "Test 1: BTC Bearish with 1h timeframe and explicit stake",
    input: "BTC won't hold above 80k in the next hour, willing to risk 50 bucks",
  },
  {
    title: "Test 2: ETH Bullish with 15m timeframe and explicit stake",
    input: "Ethereum looks primed for a breakout above 2500 over the next 15 minutes with 20 tUSDC",
  },
  {
    title: "Test 3: Deliberately Ambiguous (no clear timeframe or strike)",
    input: "Bitcoin is definitely going to dump hard",
  },
];

async function runTest(testNum, testCase, exchange) {
  console.log("=".repeat(80));
  console.log(`RUN ${testNum}: ${testCase.title}`);
  console.log(`Input Thesis: "${testCase.input}"`);
  console.log("-".repeat(80));

  // 1. Standalone Thesis Parser call (LLM call #1)
  const startTime = Date.now();
  console.log("[1] Calling parseThesis() via Gemini Flash...");
  const parsed = await parseThesis(testCase.input);
  const elapsed = Date.now() - startTime;
  console.log(`    Parsing completed in ${elapsed}ms\n`);

  // 2. Feed parsed params into SDK market lookup
  console.log("[2] Matching against live BinaryMarkets via listLiveBinaryMarkets()...");
  const matchResult = await findMatchingMarket(exchange, parsed);

  // 3. Side-by-side comparison log
  console.log("\n[3] SIDE-BY-SIDE EVALUATION:");
  console.log("┌───────────────────────────┬──────────────────────────────────────────────────────────────┐");
  console.log("│ FIELD                     │ VALUE                                                        │");
  console.log("├───────────────────────────┼──────────────────────────────────────────────────────────────┤");
  console.log(`│ [Parsed] Asset            │ ${(parsed.asset || "N/A").padEnd(60)} │`);
  console.log(`│ [Parsed] Direction        │ ${(parsed.direction || "N/A").padEnd(60)} │`);
  console.log(`│ [Parsed] Target Timeframe │ ${(parsed.targetTimeframe || "(none)").padEnd(60)} │`);
  console.log(`│ [Parsed] Target Seconds   │ ${String(parsed.targetSeconds ?? "(none)").padEnd(60)} │`);
  console.log(`│ [Parsed] Strike           │ ${String(parsed.strike ?? "(none)").padEnd(60)} │`);
  console.log(`│ [Parsed] Stake            │ ${String(parsed.stake ?? "(none)").padEnd(60)} │`);
  console.log(`│ [Parsed] Ambiguity Notes  │ ${(parsed.ambiguityNotes || "(none)").padEnd(60)} │`);
  console.log("├───────────────────────────┼──────────────────────────────────────────────────────────────┤");

  if (matchResult.success && matchResult.matched) {
    const m = matchResult.matched;
    console.log(`│ [Matched] Tradable Symbol │ ${(m.symbol || "N/A").padEnd(60)} │`);
    console.log(`│ [Matched] Market ID       │ ${(m.id || "N/A").padEnd(60)} │`);
    console.log(`│ [Matched] Strike          │ ${String(m.strike || "N/A").padEnd(60)} │`);
    console.log(`│ [Matched] Interval        │ ${(m.interval || "N/A").padEnd(60)} │`);
    console.log(`│ [Matched] Expiry Time     │ ${(m.expiryDate || "N/A").padEnd(60)} │`);
    console.log(`│ [Matched] Remaining Sec   │ ${String(m.remainingSec + "s").padEnd(60)} │`);
    console.log(`│ [Matched] Delta to Target │ ${String(m.deltaFromTargetSec !== null ? m.deltaFromTargetSec + "s" : "(no target sec)").padEnd(60)} │`);
    console.log(`│ [Matched] Recommended Side│ ${(matchResult.recommendedSide || "N/A").padEnd(60)} │`);
    console.log(`│ [Matched] Last Price      │ ${(m.lastPriceFormatted || m.lastPrice || "null (no fill yet)").padEnd(60)} │`);
  } else {
    console.log(`│ [Matched] Status          │ FAILED / NO MATCH                                            │`);
    console.log(`│ [Matched] Reason          │ ${(matchResult.reason || "Unknown").padEnd(60)} │`);
  }
  console.log("└───────────────────────────┴──────────────────────────────────────────────────────────────┘");

  // Log uncertainty or ambiguity handling
  if (matchResult.uncertainty) {
    console.log("\n⚠️  UNCERTAINTY LOGGED:");
    console.log(`    ${matchResult.uncertainty}`);
  }

  if (matchResult.candidatesSummary && matchResult.candidatesSummary.length > 0) {
    console.log("\n    Available Live Candidates for Asset:");
    matchResult.candidatesSummary.slice(0, 5).forEach((c, idx) => {
      console.log(`      ${idx + 1}. Symbol: ${c.symbol} | Interval: ${c.interval} | Time Remaining: ${c.remaining}${c.delta ? ` | Delta from Target: ${c.delta}` : ""}`);
    });
  }

  console.log("\n");
  return { parsed, matchResult };
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("SKEPTICAL COPILOT — THESIS PARSER & LIVE MARKET MATCH VERIFICATION");
  console.log("=".repeat(80) + "\n");

  console.log("Initializing shared SomniaMarkets exchange on Shannon testnet...");
  const exchange = await getExchange();
  console.log("Exchange initialized and markets loaded.\n");

  const results = [];
  for (let i = 0; i < TEST_THESES.length; i++) {
    const res = await runTest(i + 1, TEST_THESES[i], exchange);
    results.push(res);
  }

  console.log("=".repeat(80));
  console.log("ALL 3 TESTS COMPLETED");
  console.log("=".repeat(80));
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error in test-thesis-parser:", err);
  process.exit(1);
});
