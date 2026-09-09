/**
 * test-outcome-semantics.mjs
 *
 * Unit + regression tests for the outcomeSemantics helper, adversarial critic,
 * and decision synthesis prompts.
 *
 * Verifies:
 * 1. buildOutcomeContext produces explicit structured fields:
 *    openingPrice, currentPrice, outcome (UP/DOWN), side (YES/NO), settlementCondition.
 * 2. Semantic definitions:
 *    UP/YES: settlementPrice >= openingPrice
 *    DOWN/NO: settlementPrice < openingPrice
 * 3. Anti-zero-collapse rules:
 *    Explicit warnings that DOWN does not mean price goes to zero ($0) and there is no zero strike.
 * 4. Regression test:
 *    Bearish thesis ("BTC is below the opening price and I expect it to settle below")
 *    correctly reasons about crossing the opening price boundary, not zero collapse.
 * 5. Live Gemini Critic regression test (if GEMINI_API_KEY is configured).
 *
 * Usage: node scripts/test-outcome-semantics.mjs
 */

try {
  process.loadEnvFile(".env");
} catch {}

import { buildOutcomeContext } from "../src/agent/outcomeSemantics.js";
import { critiqueProposal } from "../src/agent/adversarialCritic.js";
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

function assertIncludes(str, substring, label) {
  assert(str.includes(substring), `${label} — contains "${substring}"`);
}

function assertNotIncludes(str, substring, label) {
  assert(!str.includes(substring), `${label} — does NOT contain "${substring}"`);
}

// ─── Test 1: Bearish BTC thesis with fixed strike (strike=65000) ─────────────
console.log("\n── Test 1: Bearish BTC thesis with fixed strike (down → NO, strike=65000) ──");
{
  const ctx = buildOutcomeContext({
    asset: "BTC",
    strike: 65000,
    recommendedSide: "NO",
    direction: "down",
  });

  console.log("  Output:\n" + ctx.split("\n").map(l => "    " + l).join("\n"));

  assertIncludes(ctx, "- asset: BTC", "asset field");
  assertIncludes(ctx, "- outcome: DOWN", "outcome field DOWN");
  assertIncludes(ctx, "- side: NO", "side field NO");
  assertIncludes(ctx, '- settlementCondition: "settlementPrice < 65000"', "settlementCondition field");
  assertIncludes(ctx, "UP / YES: settlementPrice >= 65000", "UP/YES definition");
  assertIncludes(ctx, "DOWN / NO: settlementPrice < 65000", "DOWN/NO definition");
  assertIncludes(ctx, 'NOT mean BTC crashes to zero ($0)', "anti-zero collapse rule");
  assertIncludes(ctx, "There is NO zero strike", "no zero strike statement");
  assertIncludes(ctx, "probability of the price crossing or remaining below the 65000 boundary", "boundary crossing instruction");
  assertNotIncludes(ctx, "BULLISH outcome (BTC settles ABOVE", "NO must not be bullish");
}

// ─── Test 2: Reference Mode with explicit openingPrice and currentPrice ──────
console.log("\n── Test 2: Reference Mode with explicit openingPrice & currentPrice ──");
{
  const ctx = buildOutcomeContext({
    asset: "BTC",
    strike: null,
    openingPrice: 65000,
    currentPrice: 64200,
    recommendedSide: "NO",
    direction: "down",
  });

  console.log("  Output:\n" + ctx.split("\n").map(l => "    " + l).join("\n"));

  assertIncludes(ctx, "- openingPrice: 65000", "openingPrice field");
  assertIncludes(ctx, "- currentPrice: 64200", "currentPrice field");
  assertIncludes(ctx, "- outcome: DOWN", "outcome is DOWN");
  assertIncludes(ctx, '- settlementCondition: "settlementPrice < 65000"', "settlementCondition with openingPrice");
  assertIncludes(ctx, "DOWN / NO: settlementPrice < 65000", "DOWN condition with openingPrice");
}

// ─── Test 3: Bullish ETH thesis (direction=up, side=YES, strike=2800) ────────
console.log("\n── Test 3: Bullish ETH thesis (up → YES) ──");
{
  const ctx = buildOutcomeContext({
    asset: "ETH",
    strike: 2800,
    recommendedSide: "YES",
    direction: "up",
  });

  console.log("  Output:\n" + ctx.split("\n").map(l => "    " + l).join("\n"));

  assertIncludes(ctx, "- outcome: UP", "outcome is UP");
  assertIncludes(ctx, "- side: YES", "side is YES");
  assertIncludes(ctx, '- settlementCondition: "settlementPrice >= 2800"', "settlementCondition is >= strike");
  assertIncludes(ctx, "UP / YES: settlementPrice >= 2800", "UP/YES definition");
}

// ─── Test 4: Reference mode without explicit numeric opening price ───────────
console.log("\n── Test 4: Reference mode fallback (no numeric strike) ──");
{
  const ctx = buildOutcomeContext({
    asset: "SOL",
    strike: null,
    recommendedSide: "NO",
    direction: "down",
  });

  console.log("  Output:\n" + ctx.split("\n").map(l => "    " + l).join("\n"));

  assertIncludes(ctx, "- openingPrice: openingPrice (set at market open / reference level)", "fallback openingPrice");
  assertIncludes(ctx, '- settlementCondition: "settlementPrice < openingPrice"', "fallback settlementCondition");
  assertIncludes(ctx, "DOWN / NO: settlementPrice < openingPrice", "fallback DOWN definition");
  assertIncludes(ctx, "UP / YES: settlementPrice >= openingPrice", "fallback UP definition");
}

// ─── Test 5: Regression Test — Bearish thesis saying BTC is below opening price
console.log("\n── Test 5: REGRESSION — Bearish below opening price (no zero collapse assumption) ──");
{
  const ctx = buildOutcomeContext({
    asset: "BTC",
    openingPrice: 65000,
    currentPrice: 64200,
    recommendedSide: "NO",
    direction: "down",
  });

  // Verify that context explicitly frames the problem as boundary crossing, not zero collapse
  assertIncludes(ctx, "settlementPrice < 65000", "settlementCondition");
  assertIncludes(ctx, "NEVER infer a target price of zero", "explicit directive against zero price target");
  assertNotIncludes(ctx, "target: $0", "no target $0");
}

// ─── Test 6: Parser extraction of openingPrice & currentPrice ────────────────
console.log("\n── Test 6: Thesis Parser extraction (openingPrice & currentPrice) ──");
if (process.env.GEMINI_API_KEY) {
  try {
    const parsed = await parseThesis("BTC is at 64200 below the opening price of 65000 and I expect it to stay below for the next 15 minutes");
    console.log("  Parsed result:", JSON.stringify(parsed, null, 2));
    assert(parsed.asset === "BTC", "asset parsed as BTC");
    assert(parsed.direction === "down", "direction parsed as down");
    assert(parsed.openingPrice === 65000 || parsed.strike === 65000, "openingPrice/strike captured as 65000");
    assert(parsed.currentPrice === 64200 || parsed.currentPrice == null, "currentPrice captured if extracted");
  } catch (err) {
    console.error("  Parser test error:", err.message);
  }
} else {
  console.log("  (Skipping live parser test — GEMINI_API_KEY not set)");
}

// ─── Test 7: Live Adversarial Critic Semantic Reasoning Test ─────────────────
console.log("\n── Test 7: Live Adversarial Critic Regression (DOWN != zero price) ──");
if (process.env.GEMINI_API_KEY) {
  try {
    const proposal = {
      parsed: {
        rawThesis: "BTC is currently at 64200 below the opening price of 65000 and I expect it to stay below for the next 15 minutes",
        asset: "BTC",
        direction: "down",
        openingPrice: 65000,
        currentPrice: 64200,
        stake: 25,
      },
      matched: {
        id: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        symbol: "BTC-0-15m/tUSDC#NO",
        asset: "BTC",
        strike: null,
        interval: "15m",
        remainingSec: 600,
        expiryDate: new Date(Date.now() + 600000).toISOString(),
        lastPrice: "480000", // 48% YES -> 52% NO
      },
      recommendedSide: "NO",
    };

    const bookState = {
      lastPrice: "480000",
      bestBid: "510000",
      bestAsk: "530000",
      mid: "520000",
    };

    console.log("  Calling critiqueProposal with bearish thesis...");
    const critique = await critiqueProposal(proposal, bookState);
    console.log("  Critique output:", JSON.stringify(critique, null, 2));

    assert(typeof critique.counterArgument === "string" && critique.counterArgument.length > 0, "critic returned counter-argument");
    assert(Array.isArray(critique.riskFactors) && critique.riskFactors.length > 0, "critic returned risk factors");

    // The counter-argument must NOT claim BTC must collapse to zero or claim DOWN is $0
    const fullText = (critique.counterArgument + " " + critique.riskFactors.join(" ")).toLowerCase();
    assertNotIncludes(fullText, "go to zero", "critic did not claim BTC must go to zero");
    assertNotIncludes(fullText, "crash to 0", "critic did not claim BTC must crash to 0");
    assertNotIncludes(fullText, "no means btc goes up", "critic did not invert NO semantics");

  } catch (err) {
    console.error("  Live critic test error:", err.message);
    failed++;
  }
} else {
  console.log("  (Skipping live critic test — GEMINI_API_KEY not set)");
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
