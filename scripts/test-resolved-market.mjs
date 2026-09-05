// scripts/test-resolved-market.mjs
// Verification test for Day 7 Calibration Service against a known-resolved market (Day 1-2 market 0x...1296a)
// Tests:
// 1. checkMarketSettlement detection on settled market (isSettled: true, winningOutcome: 0)
// 2. Relative outcome mapping for hypothetical YES trade (win -> outcome=1, Brier score=0.09)
// 3. Relative outcome mapping for hypothetical NO trade (loss -> outcome=0, Brier score=0.36)
// Does NOT modify data/trades.json

process.loadEnvFile(".env");

async function main() {
  const { getExchange } = await import("../src/sdk/client.js");
  const { checkMarketSettlement, computeBrierScore } = await import("../src/calibration/calibrationService.js");

  const exchange = await getExchange();
  const resolvedMarketId = "0x000000000000000000000000000000000000000000000000000000000001296a";

  console.log("=== Testing Settled-Path Resolution on Known Market ===");
  console.log("Market ID:", resolvedMarketId);

  const settlement = await checkMarketSettlement(exchange, resolvedMarketId);
  console.log("\nSettlement Object:");
  console.log(JSON.stringify(settlement, null, 2));

  if (!settlement.isSettled || settlement.winningOutcome !== 0) {
    throw new Error(`Expected market ${resolvedMarketId} to be settled with winningOutcome=0`);
  }

  // Scenario A: Hypothetical YES trade with statedConfidence = 0.70
  const outcomeYES = settlement.winningOutcome === 0 ? 1 : 0;
  const brierYES = computeBrierScore(0.70, outcomeYES);
  console.log("\nScenario A (Hypothetical YES trade, statedConfidence=0.70):");
  console.log("  Outcome (1=win, 0=loss):", outcomeYES);
  console.log("  Brier Score:", brierYES, "(expected: 0.09) ->", brierYES === 0.09 ? "PASSED ✅" : "FAILED ❌");

  if (brierYES !== 0.09) throw new Error("Brier calculation failed for Scenario A");

  // Scenario B: Hypothetical NO trade with statedConfidence = 0.60
  const outcomeNO = settlement.winningOutcome === 1 ? 1 : 0;
  const brierNO = computeBrierScore(0.60, outcomeNO);
  console.log("\nScenario B (Hypothetical NO trade, statedConfidence=0.60):");
  console.log("  Outcome (1=win, 0=loss):", outcomeNO);
  console.log("  Brier Score:", brierNO, "(expected: 0.36) ->", brierNO === 0.36 ? "PASSED ✅" : "FAILED ❌");

  if (brierNO !== 0.36) throw new Error("Brier calculation failed for Scenario B");

  console.log("\n✅ ALL SETTLED-PATH CHECKS PASSED!");
  await exchange.close();
}

main().catch(async (err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
