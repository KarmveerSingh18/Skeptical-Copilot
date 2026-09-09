/**
 * test-decision-confidence.mjs
 *
 * Regression tests for Decision Synthesis confidence handling and edge evaluation.
 *
 * Scenarios tested:
 * 1. 70% thesis + 50.7% executable ask + moderate critique:
 *    - Must evaluate edge = 0.70 - 0.507 = +0.193
 *    - Must NOT silently collapse confidence to 52% or decline purely because market is near 50%.
 *    - Should APPROVE (proceed: true) with preserved or calibrated confidence (e.g., >= 0.60).
 *    - Must provide machine-readable 'confidenceAdjustmentReason'.
 *
 * 2. 70% thesis + fatal contradiction critique (e.g. market has 20s left and price is 5% away in wrong direction):
 *    - Must downgrade confidence / DECLINE (proceed: false) with an explicit reason.
 *
 * Usage: node scripts/test-decision-confidence.mjs
 */

try {
  process.loadEnvFile(".env");
} catch {}

import { synthesizeDecision } from "../src/agent/decisionSynthesis.js";
import { parseThesis } from "../src/agent/thesisParser.js";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function hr(char = "─", len = 70) {
  return char.repeat(len);
}

// ─── Test 1: 70% Thesis + 50.7% Executable Ask + Moderate Critique ─────────
console.log(`\n${hr("═")}`);
console.log("TEST 1: 70% thesis + 50.7% executable ask + moderate critique (Positive EV Edge)");
console.log(`${hr("═")}`);

if (process.env.GEMINI_API_KEY) {
  try {
    const proposal = {
      parsed: {
        rawThesis: "BTC is at 64200 below opening price 65000 and I have 70% confidence it will stay below for the next 15 minutes",
        asset: "BTC",
        direction: "down",
        confidence: 0.70,
        openingPrice: 65000,
        currentPrice: 64200,
        stake: 50,
      },
      matched: {
        id: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        symbol: "BTC-0-15m/tUSDC#NO",
        asset: "BTC",
        strike: null,
        interval: "15m",
        remainingSec: 720, // 12 minutes remaining
        expiryDate: new Date(Date.now() + 720000).toISOString(),
        lastPrice: "493000", // 49.3% YES -> 50.7% NO
      },
      recommendedSide: "NO",
      bookState: {
        lastPrice: "493000",
        bestBid: "500000",
        bestAsk: "507000", // Executable NO ask is 0.5070
        mid: "503500",
      },
    };

    const critique = {
      counterArgument: "The market is almost evenly split (50.3% mid). Buying NO at 0.507 requires BTC to remain below 65000 for the next 12 minutes, but normal intraday volatility could allow an 800-point bounce back above the opening price before expiry.",
      riskFactors: [
        "12 minutes remaining allows potential mean-reversion bounce",
        "Order book is near coin-flip pricing",
        "Minor spread between 0.500 bid and 0.507 ask",
      ],
      marketAlignedAgainst: false,
      impliedProbability: 0.493,
      severityScore: 4, // moderate risk, not fatal
    };

    console.log("  Running synthesizeDecision...");
    const decision = await synthesizeDecision(proposal, critique);
    console.log("  Decision output:", JSON.stringify(decision, null, 2));

    assert(decision.proceed === true, "decision approved trade with positive edge (proceed === true)");
    assert(decision.side === "NO", "decision side is NO");
    assert(decision.statedConfidence >= 0.60, `statedConfidence (${decision.statedConfidence}) preserved edge above 0.60 (not collapsed to 52%)`);
    assert(typeof decision.confidenceAdjustmentReason === "string" && decision.confidenceAdjustmentReason.length > 10, "machine-readable confidenceAdjustmentReason provided");
    assert(typeof decision.reasoning === "string" && decision.reasoning.length > 10, "human-readable reasoning provided");

  } catch (err) {
    console.error("  Test 1 error:", err.message);
    failed++;
  }
} else {
  console.log("  (Skipping Test 1 — GEMINI_API_KEY not set)");
}

// ─── Test 2: 70% Thesis + Fatal Contradiction Critique ──────────────────────
console.log(`\n${hr("═")}`);
console.log("TEST 2: 70% thesis + Fatal Contradiction Critique (Negative EV / Fatal Risk)");
console.log(`${hr("═")}`);

if (process.env.GEMINI_API_KEY) {
  try {
    const proposal = {
      parsed: {
        rawThesis: "BTC is pumping and will close above 68000 in 30 seconds with 70% confidence",
        asset: "BTC",
        direction: "up",
        confidence: 0.70,
        strike: 68000,
        stake: 50,
      },
      matched: {
        id: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        symbol: "BTC-68000-15m/tUSDC#YES",
        asset: "BTC",
        strike: 68000,
        interval: "15m",
        remainingSec: 25, // 25 seconds left
        expiryDate: new Date(Date.now() + 25000).toISOString(),
        lastPrice: "050000", // 5% YES
      },
      recommendedSide: "YES",
      bookState: {
        lastPrice: "050000",
        bestBid: "030000",
        bestAsk: "100000", // Ask is 0.10, but mid is 0.05
        mid: "065000",
      },
    };

    const critique = {
      counterArgument: "Fatal contradiction: BTC is currently at 64,100, which is $3,900 below the 68,000 strike with only 25 seconds remaining. A 6% move in 25 seconds is mathematically nearly impossible, and the market prices YES at only 5%.",
      riskFactors: [
        "Only 25 seconds remaining with a $3,900 gap to strike",
        "Requires impossible 6% price movement in seconds",
        "Market is priced at 5% YES reflecting near certainty of loss",
      ],
      marketAlignedAgainst: true,
      impliedProbability: 0.05,
      severityScore: 10, // fatal refutation
    };

    console.log("  Running synthesizeDecision for fatal contradiction...");
    const decision = await synthesizeDecision(proposal, critique);
    console.log("  Decision output:", JSON.stringify(decision, null, 2));

    assert(decision.proceed === false, "decision declined trade with fatal contradiction (proceed === false)");
    assert(decision.statedConfidence <= 0.60, `statedConfidence (${decision.statedConfidence}) properly downgraded on fatal flaw`);
    assert(typeof decision.confidenceAdjustmentReason === "string" && decision.confidenceAdjustmentReason.length > 10, "machine-readable confidenceAdjustmentReason provided for decline");

  } catch (err) {
    console.error("  Test 2 error:", err.message);
    failed++;
  }
} else {
  console.log("  (Skipping Test 2 — GEMINI_API_KEY not set)");
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${hr("═")}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${hr("═")}`);
process.exit(failed > 0 ? 1 : 0);
