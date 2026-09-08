// scripts/find-best-market.mjs
process.loadEnvFile(".env");
import { getExchange } from "../src/sdk/client.js";

async function main() {
  console.log("Connecting to exchange...");
  const ex = await getExchange();
  const markets = await ex.client.listLiveBinaryMarkets();
  const now = Math.floor(Date.now() / 1000);
  console.log(`Found ${markets.length} live markets.`);

  const PREV_ID = "0x0000000000000000000000000000000000000000000000000000000000013bc2";
  const active = markets.filter(m => {
    const rem = Number(m.expiry) - now;
    return rem >= 300 && m.id.toLowerCase() !== PREV_ID.toLowerCase();
  });

  const ids = active.map(m => m.id);
  console.log(`Fetching book tops for ${ids.length} markets...`);
  const tops = await ex.client.getBookTops(ids);

  const results = [];
  for (const m of active) {
    const top = tops[m.id.toLowerCase()] || tops[m.id];
    const remSec = Number(m.expiry) - now;
    const sym = ex.market(m.id)?.symbol;
    results.push({
      id: m.id,
      asset: m.asset,
      interval: m.interval,
      expiry: m.expiry,
      symbol: sym,
      remMin: Math.round(remSec / 60),
      remHours: (remSec / 3600).toFixed(1),
      bestBid: top?.bestBid?.price ?? top?.bestBid ?? null,
      bestAsk: top?.bestAsk?.price ?? top?.bestAsk ?? null,
      mid: top?.mid ?? null,
    });
  }

  console.log("\n--- ACTIVE LIVE MARKETS ---");
  for (const r of results) {
    console.log(`${r.asset} ${r.interval} | Rem: ${r.remMin}m (${r.remHours}h) | Mid: ${r.mid} | Bid: ${r.bestBid} | Ask: ${r.bestAsk} | Sym: ${r.symbol}`);
  }
}

main().catch(console.error);
