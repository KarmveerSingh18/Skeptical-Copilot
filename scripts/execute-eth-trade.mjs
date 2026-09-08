// scripts/execute-eth-trade.mjs
process.loadEnvFile(".env");
import { getExchange } from "../src/sdk/client.js";
import { runPipeline } from "../src/sdk/pipeline.js";
import { readTradeLog } from "../src/calibration/tradeLog.js";

async function main() {
  console.log("================================================================================");
  console.log("  EXECUTING TRADE #4 ON ETH-0-07SEP26 VIA FULL 3-STAGE REASONING PIPELINE       ");
  console.log("================================================================================\n");

  const exchange = await getExchange();
  console.log(`Connected to Somnia Shannon testnet as: ${exchange.walletAddress}\n`);

  const thesisText = "ETH is trading with steady upside momentum in its 24-hour event contract window with 6.9 hours (411m) remaining before settlement. The live order book reflects a 59.6% implied probability for YES at mid with tight two-sided liquidity (best bid 0.582, best ask 0.611). Taking a 1 contract YES position aligned with this ~60% market consensus reflects current baseline probability with ample time before expiry and minimal spread friction.";

  console.log("Thesis Input:");
  console.log(`"${thesisText}"\n`);

  console.log("Running pipeline with forceExecute = false...");
  const t0 = Date.now();

  const result = await runPipeline({
    thesisText,
    exchange,
    forceExecute: false, // Organic synthesis
    confirmGate: async (data) => {
      console.log("\n==================================================");
      console.log("  CONFIRM GATE TRIGGERED (SYNTHESIS APPROVED)      ");
      console.log("==================================================");
      console.log("  Matched Market:     ", data.matched.symbol);
      console.log("  Market ID:          ", data.matched.id);
      console.log("  Recommended Side:   ", data.recommendedSide);
      console.log("  Decision Side:      ", data.decision.side);
      console.log("  Stated Confidence:  ", data.decision.statedConfidence);
      console.log("  Decision Rationale: ", data.decision.reasoning);
      console.log("==================================================\n");
      return true; // Explicit confirmation
    },
    orderAmount: 1,
  });

  const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nPipeline finished in ${totalTime}s\n`);

  console.log("--------------------------------------------------------------------------------");
  console.log("  FULL REASONING TRAIL                                                          ");
  console.log("--------------------------------------------------------------------------------");

  // Stage 1: Parse
  console.log("\n[STAGE 1: THESIS PARSER]");
  console.log(JSON.stringify(result.stages.parse?.output, null, 2));

  // Market Match & Book
  console.log("\n[STAGE 1b: MARKET MATCH & ORDER BOOK]");
  console.log("Matched Symbol:  ", result.stages.match?.matched?.symbol);
  console.log("Market ID:       ", result.stages.match?.matched?.id);
  console.log("Book State:      ", JSON.stringify(result.stages.bookState, null, 2));

  // Stage 2: Critic
  console.log("\n[STAGE 2: ADVERSARIAL CRITIC]");
  console.log("Severity (1-10): ", result.stages.critique?.output?.severityScore);
  console.log("Market Aligned Against:", result.stages.critique?.output?.marketAlignedAgainst);
  console.log("Counter-Argument:\n", result.stages.critique?.output?.counterArgument);
  console.log("Risk Factors:\n", result.stages.critique?.output?.riskFactors);

  // Stage 3: Synthesis
  console.log("\n[STAGE 3: DECISION SYNTHESIS]");
  console.log("Proceed:           ", result.stages.synthesis?.output?.proceed);
  console.log("Side:              ", result.stages.synthesis?.output?.side);
  console.log("Stated Confidence: ", result.stages.synthesis?.output?.statedConfidence);
  console.log("Reasoning:\n", result.stages.synthesis?.output?.reasoning);

  // Execution result
  console.log("\n--------------------------------------------------------------------------------");
  console.log("  EXECUTION & ON-CHAIN CONFIRMATION                                             ");
  console.log("--------------------------------------------------------------------------------");
  console.log("Order Placed:      ", result.orderPlaced);
  console.log("Declined Reason:   ", result.declinedReason || "None (Proceeded)");

  if (result.order) {
    console.log("Order ID:          ", result.order.id);
    console.log("Order Price:       ", result.order.price);
    console.log("Order Status:      ", result.order.status);
    console.log("Filled Amount:     ", result.order.filled);
    console.log("Transaction Hash:  ", result.txHash || result.order.txHash || result.order.info?.hash);
  }

  // Trades log
  console.log("\n--------------------------------------------------------------------------------");
  console.log("  UPDATED DATA/TRADES.JSON                                                      ");
  console.log("--------------------------------------------------------------------------------");
  const trades = readTradeLog();
  console.log(`Total trades: ${trades.length}`);
  console.log(JSON.stringify(trades, null, 2));
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
