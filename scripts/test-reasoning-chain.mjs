// scripts/test-reasoning-chain.mjs
// Tests the full 3-stage reasoning pipeline: Parse → Critique → Synthesize
// against the two non-ambiguous theses from Day 3-4. Does NOT place any orders.
process.loadEnvFile(".env");

import { parseThesis } from "../src/agent/thesisParser.js";
import { getExchange } from "../src/sdk/client.js";
import { findMatchingMarket } from "../src/sdk/marketLookup.js";
import { critiqueProposal } from "../src/agent/adversarialCritic.js";
import { synthesizeDecision } from "../src/agent/decisionSynthesis.js";

const TEST_THESES = [
  {
    title: "Test 1: BTC Bearish — 1h timeframe, $50 stake",
    input: "BTC won't hold above 80k in the next hour, willing to risk 50 bucks",
  },
  {
    title: "Test 2: ETH Bullish — 15m timeframe, 20 tUSDC stake",
    input: "Ethereum looks primed for a breakout above 2500 over the next 15 minutes with 20 tUSDC",
  },
];

function hr(char = "─", len = 90) { return char.repeat(len); }
function section(title) { console.log(`\n${"═".repeat(90)}\n  ${title}\n${"═".repeat(90)}`); }

async function runFullChain(testNum, testCase, exchange) {
  section(`RUN ${testNum}: ${testCase.title}`);
  console.log(`Input: "${testCase.input}"\n`);

  // ─── STAGE 1: Thesis Parser (LLM #1) ──────────────────────────────────
  console.log(`${hr("─")} STAGE 1: Thesis Parser ${hr("─", 50)}`);
  const t1 = Date.now();
  const parsed = await parseThesis(testCase.input);
  const parseMs = Date.now() - t1;
  console.log(`  Model: gemini-3.1-flash-lite | Latency: ${parseMs}ms`);
  console.log(`  Asset: ${parsed.asset} | Direction: ${parsed.direction} | Timeframe: ${parsed.targetTimeframe ?? "(none)"} | Target: ${parsed.targetSeconds ?? "(none)"}s`);
  console.log(`  Strike: ${parsed.strike ?? "N/A"} | Stake: ${parsed.stake ?? "N/A"} | Ambiguity: ${parsed.ambiguityNotes ?? "none"}`);

  // ─── Market Match ──────────────────────────────────────────────────────
  console.log(`\n${hr("─")} Market Match ${hr("─", 60)}`);
  const matchResult = await findMatchingMarket(exchange, parsed);
  if (!matchResult.success) {
    console.error(`  ❌ Match failed: ${matchResult.reason}`);
    return;
  }
  const { matched, recommendedSide } = matchResult;
  console.log(`  Symbol: ${matched.symbol}`);
  console.log(`  Interval: ${matched.interval} | Remaining: ${matched.remainingSec}s (${Math.round(matched.remainingSec / 60)}m)`);
  console.log(`  Last Price: ${matched.lastPriceFormatted || matched.lastPrice || "(no fill)"}`);
  console.log(`  Recommended Side: ${recommendedSide}`);

  // ─── Fetch Book Tops for grounding ─────────────────────────────────────
  console.log(`\n${hr("─")} Book State (getBookTops) ${hr("─", 48)}`);
  let bookState = { lastPrice: matched.lastPrice, bestBid: null, bestAsk: null, mid: null };
  try {
    const tops = await exchange.client.getBookTops([matched.id]);
    const top = tops[matched.id.toLowerCase()] || tops[matched.id];
    if (top) {
      bookState.bestBid = top.bestBid;
      bookState.bestAsk = top.bestAsk;
      bookState.mid = top.mid;
      const fmtPrice = (raw) => raw ? `${raw} (${(Number(raw) / 1e6).toFixed(4)})` : "none";
      console.log(`  Best Bid: ${fmtPrice(top.bestBid)}`);
      console.log(`  Best Ask: ${fmtPrice(top.bestAsk)}`);
      console.log(`  Mid:      ${fmtPrice(top.mid)}`);
    } else {
      console.log(`  (no book data returned for this market — book may be empty)`);
    }
  } catch (err) {
    console.log(`  ⚠️ getBookTops error: ${err.message} — proceeding with lastPrice only`);
  }

  // ─── STAGE 2: Adversarial Critic (LLM #2) ─────────────────────────────
  const proposal = { parsed, matched, recommendedSide };

  console.log(`\n${hr("─")} STAGE 2: Adversarial Critic ${hr("─", 44)}`);
  const t2 = Date.now();
  const critique = await critiqueProposal(proposal, bookState);
  const critiqueMs = Date.now() - t2;
  console.log(`  Model: ${critique.model} | Latency: ${critiqueMs}ms`);
  console.log(`  Severity: ${critique.severityScore}/10 | Market Aligned Against: ${critique.marketAlignedAgainst}`);
  console.log(`  Implied YES Probability: ${critique.impliedProbability !== null ? (critique.impliedProbability * 100).toFixed(1) + "%" : "N/A"}`);
  console.log(`\n  COUNTER-ARGUMENT:`);
  console.log(`  "${critique.counterArgument}"`);
  console.log(`\n  RISK FACTORS:`);
  critique.riskFactors.forEach((r, i) => console.log(`    ${i + 1}. ${r}`));

  // ─── STAGE 3: Decision Synthesis (LLM #3) ─────────────────────────────
  console.log(`\n${hr("─")} STAGE 3: Decision Synthesis ${hr("─", 44)}`);
  const t3 = Date.now();
  const decision = await synthesizeDecision(proposal, critique);
  const synthMs = Date.now() - t3;
  console.log(`  Model: ${decision.model} | Latency: ${synthMs}ms`);
  console.log(`  PROCEED: ${decision.proceed ? "✅ YES" : "🛑 NO"}`);
  console.log(`  Side: ${decision.side}`);
  console.log(`  Stated Confidence: ${(decision.statedConfidence * 100).toFixed(1)}% (of ${decision.side} winning)`);
  console.log(`\n  REASONING:`);
  console.log(`  "${decision.reasoning}"`);

  // ─── Summary Table ─────────────────────────────────────────────────────
  console.log(`\n${hr("─")} PIPELINE SUMMARY ${hr("─", 54)}`);
  console.log(`  Total Latency: ${parseMs + critiqueMs + synthMs}ms (parse: ${parseMs}ms, critique: ${critiqueMs}ms, synthesis: ${synthMs}ms)`);
  console.log(`  ┌──────────────────┬───────────────────────────────────────────────────┐`);
  console.log(`  │ Parser Output    │ ${parsed.asset} ${parsed.direction} → ${recommendedSide} (${parsed.targetTimeframe ?? "?"})`.padEnd(70) + `│`);
  console.log(`  │ Critic Severity  │ ${critique.severityScore}/10`.padEnd(70) + `│`);
  console.log(`  │ Final Decision   │ ${decision.proceed ? "PROCEED" : "DECLINE"} ${decision.side} @ ${(decision.statedConfidence * 100).toFixed(1)}%`.padEnd(70) + `│`);
  console.log(`  └──────────────────┴───────────────────────────────────────────────────┘`);

  return { parsed, matched, critique, decision };
}

async function main() {
  section("SKEPTICAL COPILOT — FULL 3-STAGE REASONING CHAIN TEST");
  console.log("  Pipeline: parseThesis() → critiqueProposal() → synthesizeDecision()");
  console.log("  No orders will be placed — reasoning chain verification only.\n");

  console.log("Initializing exchange...");
  const exchange = await getExchange();
  console.log("Exchange ready.\n");

  for (let i = 0; i < TEST_THESES.length; i++) {
    await runFullChain(i + 1, TEST_THESES[i], exchange);
    if (i < TEST_THESES.length - 1) console.log("\n");
  }

  section("ALL TESTS COMPLETED — NO ORDERS PLACED");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
