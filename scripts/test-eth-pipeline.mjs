// scripts/test-eth-pipeline.mjs
process.loadEnvFile(".env");
import { getExchange } from "../src/sdk/client.js";
import { runPipeline } from "../src/sdk/pipeline.js";
import { readTradeLog } from "../src/calibration/tradeLog.js";

async function main() {
  console.log("1. Connecting to Somnia testnet...");
  const exchange = await getExchange();
  console.log(`   Connected as: ${exchange.walletAddress}`);

  // Construct thesis targeting ETH 24h market
  const thesis = "ETH will hold steady in the 24-hour event contract window with 7 hours remaining before settlement. The live order book reflects a 50% baseline implied probability at mid. Taking a 1 contract YES position aligned with the 50% market mid probability provides a balanced probabilistic entry with ample time before expiry.";

  console.log("\n2. Running pipeline on ETH 24h thesis:");
  console.log(`   "${thesis}"\n`);

  const result = await runPipeline({
    thesisText: thesis,
    exchange,
    forceExecute: false, // Organic synthesis approval
    confirmGate: async (data) => {
      console.log("\n>>> CONFIRM GATE TRIGGERED <<<");
      console.log("   Market:", data.matched.symbol, "(ID:", data.matched.id, ")");
      console.log("   Side:", data.decision.side);
      console.log("   Stated Confidence:", data.decision.statedConfidence);
      console.log("   Reasoning:", data.decision.reasoning);
      return true; // Auto-confirm
    },
    orderAmount: 1,
  });

  console.log("\n3. Pipeline Execution Results:");
  console.log("   Declined:", result.declinedReason || "No (Approved)");
  console.log("   Order Placed:", result.orderPlaced);
  if (result.order) {
    console.log("   Order ID:", result.order.id);
    console.log("   Order Price:", result.order.price);
    console.log("   Order Status:", result.order.status);
    console.log("   Order Filled:", result.order.filled);
    console.log("   Tx Hash:", result.txHash || result.order.txHash || result.order.info?.hash);
  }

  console.log("\n4. Checking data/trades.json...");
  const trades = readTradeLog();
  console.log(`   Total trades in log: ${trades.length}`);
  const latest = trades[trades.length - 1];
  console.log("   Latest Trade Record:");
  console.log(JSON.stringify(latest, null, 2));
}

main().catch(err => {
  console.error("Pipeline run failed:", err);
  process.exit(1);
});
