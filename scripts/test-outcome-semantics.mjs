/**
 * test-outcome-semantics.mjs
 *
 * Unit + regression tests for the outcomeSemantics helper.
 * Verifies that buildOutcomeContext produces correct, unambiguous descriptions
 * for all direction/side combinations, and specifically that bearish (NO) theses
 * are NOT described as bullish.
 *
 * No live SDK or Gemini calls — pure function testing.
 *
 * Usage: node scripts/test-outcome-semantics.mjs
 */

import { buildOutcomeContext } from "../src/agent/outcomeSemantics.js";

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

// ─── Test 1: Bearish BTC thesis (direction=down, side=NO, strike=65000) ──────
console.log("\n── Test 1: Bearish BTC thesis (down → NO) ──");
{
  const ctx = buildOutcomeContext({
    asset: "BTC",
    strike: 65000,
    recommendedSide: "NO",
    direction: "down",
  });

  console.log("  Output:\n" + ctx.split("\n").map(l => "    " + l).join("\n"));

  // Market question is correct
  assertIncludes(ctx, 'Will BTC settle above 65000?', "market question");

  // YES = bullish, NO = bearish (correct semantics)
  assertIncludes(ctx, "YES = price ends ABOVE 65000 (bullish outcome)", "YES meaning");
  assertIncludes(ctx, "NO = price ends BELOW 65000 (bearish outcome)", "NO meaning");

  // Side explanation says NO = bearish
  assertIncludes(ctx, "proposed side is NO", "side is NO");
  assertIncludes(ctx, "BEARISH outcome", "NO described as bearish");

  // Direction check says bearish/down is consistent with NO
  assertIncludes(ctx, "bearish (direction: down)", "direction label");
  assertIncludes(ctx, "consistent with buying NO", "consistency check");

  // REGRESSION: Must NOT say "NO means BTC goes UP" or describe NO as bullish
  assertNotIncludes(ctx, "BULLISH outcome (BTC settles ABOVE", "NO must not be bullish");
  // The word BULLISH should only appear in the YES description, not in the side explanation
  const sideLines = ctx.split("\n").filter(l => l.includes("proposed side is NO"));
  for (const line of sideLines) {
    assertNotIncludes(line, "BULLISH", "NO side line must not say BULLISH");
  }
}

// ─── Test 2: Bullish ETH thesis (direction=up, side=YES, strike=2800) ────────
console.log("\n── Test 2: Bullish ETH thesis (up → YES) ──");
{
  const ctx = buildOutcomeContext({
    asset: "ETH",
    strike: 2800,
    recommendedSide: "YES",
    direction: "up",
  });

  console.log("  Output:\n" + ctx.split("\n").map(l => "    " + l).join("\n"));

  assertIncludes(ctx, 'Will ETH settle above 2800?', "market question");
  assertIncludes(ctx, "YES = price ends ABOVE 2800 (bullish outcome)", "YES meaning");
  assertIncludes(ctx, "NO = price ends BELOW 2800 (bearish outcome)", "NO meaning");
  assertIncludes(ctx, "proposed side is YES", "side is YES");
  assertIncludes(ctx, "BULLISH outcome", "YES described as bullish");
  assertIncludes(ctx, "consistent with buying YES", "consistency check");
}

// ─── Test 3: No strike (at-the-money) ────────────────────────────────────────
console.log("\n── Test 3: No strike (at-the-money) ──");
{
  const ctx = buildOutcomeContext({
    asset: "SOL",
    strike: null,
    recommendedSide: "YES",
    direction: "up",
  });

  console.log("  Output:\n" + ctx.split("\n").map(l => "    " + l).join("\n"));

  assertIncludes(ctx, "the opening/reference level", "fallback strike label");
  assertIncludes(ctx, 'Will SOL settle above the opening/reference level?', "market question with fallback");
}

// ─── Test 4: Strike = 0 (edge case — should use "0" not fallback) ────────────
console.log("\n── Test 4: Strike = 0 edge case ──");
{
  const ctx = buildOutcomeContext({
    asset: "BTC",
    strike: 0,
    recommendedSide: "YES",
    direction: "up",
  });

  // strike 0 is truthy-falsy edge case — should use "0" as the label
  assertIncludes(ctx, "Will BTC settle above 0?", "zero strike renders as 0");
}

// ─── Test 5: Bearish ETH (regression — the original bug scenario) ────────────
console.log("\n── Test 5: REGRESSION — Bearish ETH + NO must not be flagged as contradiction ──");
{
  const ctx = buildOutcomeContext({
    asset: "ETH",
    strike: 3500,
    recommendedSide: "NO",
    direction: "down",
  });

  console.log("  Output:\n" + ctx.split("\n").map(l => "    " + l).join("\n"));

  // The context must clearly state that NO = bearish and direction down is consistent
  assertIncludes(ctx, "NO = price ends BELOW 3500 (bearish outcome)", "NO = bearish");
  assertIncludes(ctx, "consistent with buying NO", "down + NO consistent");
  assertNotIncludes(ctx, "NO means BTC goes UP", "no inverted semantics (BTC variant)");
  assertNotIncludes(ctx, "NO means ETH goes UP", "no inverted semantics (ETH variant)");

  // Side explanation must say BEARISH, not BULLISH
  const noSideLines = ctx.split("\n").filter(l => l.includes("proposed side is NO"));
  for (const line of noSideLines) {
    assertIncludes(line, "BEARISH", "NO side line says BEARISH");
    assertNotIncludes(line, "BULLISH", "NO side line does not say BULLISH");
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
