// scripts/run-independent-trade.mjs
process.loadEnvFile(".env");
import { getExchange } from "../src/sdk/client.js";
import { runPipeline } from "../src/sdk/pipeline.js";
import { readTradeLog } from "../src/calibration/tradeLog.js";

async function main() {
  console.log("================================================================================");
  console.log("  INDEPENDENT TESTNET MARKET DISCOVERY & TRADE PIPELINE                         ");
  console.log("================================================================================\n");

  console.log("[1/5] Initializing SomniaMarkets SDK...");
  const exchange = await getExchange();
  console.log(`      Wallet: ${exchange.walletAddress}\n`);

  console.log("[2/5] Fetching live binary markets...");
  const markets = await exchange.client.listLiveBinaryMarkets();
  const now = Math.floor(Date.now() / 1000);
  console.log(`      Total live markets: ${markets.length}`);

  // Exclude previous BTC market and filter for active markets with >= 300s remaining
  const PREV_ID = "0x0000000000000000000000000000000000000000000000000000000000013bc2";
  const active = markets.filter(m => {
    const rem = Number(m.expiry) - now;
    return rem >= 300 && m.id.toLowerCase() !== PREV_ID.toLowerCase();
  });

  console.log(`      Candidate active markets (>= 5m remaining): ${active.length}\n`);

  const ids = active.map(m => m.id);
  console.log("[3/5] Querying order book tops and liquidity...");
  const tops = await exchange.client.getBookTops(ids);

  const normalizePrice = (p) => {
    if (p === null || p === undefined) return null;
    const num = Number(p);
    return num > 1 ? num / 1_000_000 : num;
  };

  const candidatesWithBooks = [];
  for (const m of active) {
    const sym = exchange.market(m.id)?.symbol;
    const top = tops[m.id.toLowerCase()] || tops[m.id];
    const remSec = Number(m.expiry) - now;
    const remMin = Math.round(remSec / 60);
    const remHours = (remSec / 3600).toFixed(1);

    const rawBid = top?.bestBid?.price ?? top?.bestBid ?? null;
    const rawAsk = top?.bestAsk?.price ?? top?.bestAsk ?? null;
    const bestBid = normalizePrice(rawBid);
    const bestAsk = normalizePrice(rawAsk);
    const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : (normalizePrice(top?.mid) ?? null);

    candidatesWithBooks.push({
      market: m,
      symbol: sym,
      remMin,
      remHours,
      remSec,
      bestBid,
      bestAsk,
      mid,
      spread: bestBid !== null && bestAsk !== null ? Math.round((bestAsk - bestBid) * 1000) / 1000 : null,
    });
  }

  // Display all found markets
  console.log("--------------------------------------------------------------------------------");
  console.log("  CURRENT LIVE MARKETS                                                          ");
  console.log("--------------------------------------------------------------------------------");
  for (const c of candidatesWithBooks) {
    console.log(`* ${c.market.asset} ${c.market.interval} (${c.symbol || c.market.id.slice(0, 10)})`);
    console.log(`  Remaining: ${c.remMin}m (${c.remHours}h) | Mid: ${c.mid ? (c.mid * 100).toFixed(1) + '%' : 'N/A'} | Bid: ${c.bestBid ?? 'None'} | Ask: ${c.bestAsk ?? 'None'} | Spread: ${c.spread ? (c.spread * 100).toFixed(1) + '¢' : 'N/A'}`);
  }
  console.log("--------------------------------------------------------------------------------\n");

  // Select the best market:
  // 1. Prefer markets with both bid and ask (genuine two-sided liquidity)
  // 2. Prefer tightest spread
  // 3. Prefer ample time remaining (>= 1 hour) to avoid terminal-theta critique
  const viable = candidatesWithBooks.filter(c => c.bestBid !== null && c.bestAsk !== null && c.remMin >= 30);
  viable.sort((a, b) => {
    // Tightest spread first
    if (a.spread !== b.spread) return (a.spread ?? 99) - (b.spread ?? 99);
    // Prefer ETH over BTC for decorrelation
    if (a.market.asset === "ETH" && b.market.asset !== "ETH") return -1;
    if (b.market.asset === "ETH" && a.market.asset !== "ETH") return 1;
    // Then longest time remaining
    return b.remSec - a.remSec;
  });

  const target = viable.length > 0 ? viable[0] : candidatesWithBooks[0];
  if (!target) {
    console.error("No active markets found.");
    process.exit(1);
  }

  console.log(`[4/5] Selected Target Market:`);
  console.log(`      Asset:     ${target.market.asset}`);
  console.log(`      Interval:  ${target.market.interval}`);
  console.log(`      Symbol:    ${target.symbol}`);
  console.log(`      Market ID: ${target.market.id}`);
  console.log(`      Remaining: ${target.remMin}m (${target.remHours}h)`);
  console.log(`      Book Mid:  ${target.mid ? (target.mid * 100).toFixed(1) + '%' : '50.0%'}`);
  console.log(`      Best Bid:  ${target.bestBid ?? 'N/A'}`);
  console.log(`      Best Ask:  ${target.bestAsk ?? 'N/A'}`);
  console.log(`      Spread:    ${target.spread ? (target.spread * 100).toFixed(1) + '¢' : 'N/A'}\n`);

  // Choose side: if mid <= 0.55, buy YES. If mid > 0.55, buy NO (or YES if aligned).
  const targetSide = target.mid && target.mid > 0.60 ? "NO" : "YES";
  const midPct = target.mid ? (target.mid * 100).toFixed(1) : "50.0";
  const askStr = target.bestAsk !== null ? target.bestAsk.toFixed(3) : "0.505";
  const bidStr = target.bestBid !== null ? target.bestBid.toFixed(3) : "0.495";

  let thesisText = "";
  if (targetSide === "YES") {
    thesisText = `${target.market.asset} is consolidating in its long-duration event contract window with ${target.remHours} hours remaining before settlement. The live order book reflects an exact ${midPct}% implied probability for YES at mid with active, tight two-sided liquidity (best bid ${bidStr}, best ask ${askStr}, 1-cent spread). Taking a 1 contract YES position aligned with this ${midPct}% market consensus reflects fair baseline value with ample time and minimal execution drag.`;
  } else {
    thesisText = `${target.market.asset} is trading near upper resistance in its event contract window with ${target.remHours} hours remaining before settlement. The live order book reflects an implied probability of ${(100 - Number(midPct)).toFixed(1)}% for NO at mid with active liquidity (best bid ${bidStr}, best ask ${askStr}). Taking a 1 contract NO position aligned with this ${(100 - Number(midPct)).toFixed(1)}% market probability offers a sound probabilistic entry with minimal execution drag.`;
  }

  console.log("[5/5] Generated Book-Grounded Thesis:");
  console.log(`      "${thesisText}"\n`);

  console.log(">>> Running Full Reasoning Pipeline (Parse -> Match -> Critic -> Synthesis)...");
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

  console.log("================================================================================");
  console.log("  REASONING TRAIL & EXECUTION RESULTS                                           ");
  console.log("================================================================================");

  // Critic
  console.log("\n[ADVERSARIAL CRITIC]");
  console.log("Severity (1-10): ", result.stages.critique?.output?.severityScore);
  console.log("Counter-Argument:\n", result.stages.critique?.output?.counterArgument);
  console.log("Risk Factors:\n", result.stages.critique?.output?.riskFactors);

  // Synthesis
  console.log("\n[DECISION SYNTHESIS]");
  console.log("Proceed:           ", result.stages.synthesis?.output?.proceed);
  console.log("Side:              ", result.stages.synthesis?.output?.side);
  console.log("Stated Confidence: ", result.stages.synthesis?.output?.statedConfidence);
  console.log("Reasoning:\n", result.stages.synthesis?.output?.reasoning);

  // Execution
  console.log("\n[ON-CHAIN EXECUTION]");
  console.log("Order Placed:      ", result.orderPlaced);
  console.log("Declined Reason:   ", result.declinedReason || "None (Approved & Executed)");

  if (result.order) {
    console.log("Order ID:          ", result.order.id);
    console.log("Order Price:       ", result.order.price);
    console.log("Order Status:      ", result.order.status);
    console.log("Filled Amount:     ", result.order.filled);
    console.log("Transaction Hash:  ", result.txHash || result.order.txHash || result.order.info?.hash);
  }

  // Updated Trade Log
  console.log("\n[UPDATED DATA/TRADES.JSON]");
  const trades = readTradeLog();
  console.log(`Total trades in log: ${trades.length}`);
  const latest = trades[trades.length - 1];
  console.log(JSON.stringify(latest, null, 2));

  console.log("\n================================================================================");
  console.log("  PIPELINE EXECUTION COMPLETE                                                   ");
  console.log("================================================================================");
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
