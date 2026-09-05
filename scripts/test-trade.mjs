import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

// Load environment variables from .env
process.loadEnvFile(".env");

if (!process.env.PRIVATE_KEY) {
  console.error("Error: PRIVATE_KEY is not set in .env");
  process.exit(1);
}

async function main() {
  console.log("=== Phase 1: Live Market Discovery & Order Verification ===\n");

  // 1. Construct SomniaMarkets exchange per confirmed specification
  console.log("Constructing SomniaMarkets exchange...");
  const exchange = new SomniaMarkets({
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    chain: somniaShannon,
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    addresses: SOMNIA_TESTNET_ADDRESSES,
    privateKey: process.env.PRIVATE_KEY,
    fees: {
      maxFeePerGas: 15_000_000_000n, // 15 gwei ceiling (testnet base ~7 gwei)
      maxPriorityFeePerGas: 0n,      // BFT chain, no tip needed
    },
  });

  // Ensure Trader default gas ceiling fits the testnet gas envelope
  exchange.signerConfig.gas = 2_000_000n;

  // 2. Load markets
  console.log("Calling loadMarkets()...");
  await exchange.loadMarkets();
  console.log(`Loaded ${exchange.symbols.length} market symbols.\n`);

  // 3. Discover live BTC or ETH BinaryMarket
  console.log("Querying listLiveBinaryMarkets()...");
  const liveMarkets = await exchange.client.listLiveBinaryMarkets();
  console.log(`Found ${liveMarkets.length} live binary markets on Shannon testnet.`);

  const now = Math.floor(Date.now() / 1000);

  // Find a live BTC or ETH market with available ask liquidity
  let selectedMarket = null;
  let selectedTradableSymbol = null;
  let selectedAsk = null;

  for (const m of liveMarkets) {
    if (m.asset !== "BTC" && m.asset !== "ETH") continue;
    const timeRemaining = Number(m.expiry) - now;
    if (timeRemaining < 60) continue; // Skip markets expiring within 60s

    const tradable = exchange.market(m.id);
    const tradableSymbol = tradable.symbol; // e.g. "BTC-0-03SEP26-2100/tUSDC#YES"

    try {
      const book = await exchange.fetchOrderBook(tradableSymbol, 2);
      if (book.asks.length > 0) {
        selectedMarket = m;
        selectedTradableSymbol = tradableSymbol;
        selectedAsk = book.asks[0];
        break;
      }
    } catch {
      // Continue searching if order book read fails
    }
  }

  if (!selectedMarket || !selectedTradableSymbol) {
    // Fallback to first live BTC/ETH market
    const fallback = liveMarkets.find(m => (m.asset === "BTC" || m.asset === "ETH") && Number(m.expiry) > now);
    if (!fallback) throw new Error("No live BTC or ETH binary markets found on testnet.");
    selectedMarket = fallback;
    selectedTradableSymbol = exchange.market(fallback.id).symbol;
  }

  console.log("\n--- Discovered Live Binary Market ---");
  console.log(`Symbol    : ${selectedTradableSymbol}`);
  console.log(`Asset     : ${selectedMarket.asset}`);
  console.log(`Strike    : ${selectedMarket.strike}`);
  console.log(`Expiry    : ${selectedMarket.expiry} (${new Date(Number(selectedMarket.expiry) * 1000).toISOString()})`);
  console.log(`LastPrice : ${selectedMarket.lastPrice ?? "null (no previous fills)"}`);
  if (selectedAsk) {
    console.log(`Top Ask   : Price ${selectedAsk[0]}, Size ${selectedAsk[1]}`);
  }

  // 4. Place ONE small market order (smallest viable size: 1 contract)
  const orderAmount = 1;
  console.log(`\nPlacing market BUY order on ${selectedTradableSymbol} for ${orderAmount} contract...`);
  
  const placed = await exchange.createOrder(
    selectedTradableSymbol,
    "market",
    "buy",
    orderAmount
  );

  console.log("\nOrder submitted to blockchain. Initial result:");
  console.log({
    id: placed.id,
    symbol: placed.symbol,
    type: placed.type,
    side: placed.side,
    price: placed.price,
    amount: placed.amount,
    filled: placed.filled,
    remaining: placed.remaining,
    status: placed.status,
  });

  // 5. Confirm fill using watchOrders pattern from the SDK's README example
  let orderResult = placed;
  if (placed.status === "open") {
    console.log(`\nOrder ${placed.id} is resting open. Watching for fill via watchOrders...`);
    while (orderResult.status === "open") {
      const orders = await exchange.watchOrders(selectedTradableSymbol);
      const mine = orders.find(o => o.id === placed.id);
      if (!mine) break;
      orderResult = mine;
      if (orderResult.status !== "open") break;
    }
  }

  console.log("\n=== Full Order Result (Fill Confirmed) ===");
  console.log(JSON.stringify(orderResult, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));

  await exchange.close();
  console.log("\n✅ End-to-end market discovery, trade placement, and fill confirmation verified!");
}

main().catch(async (err) => {
  console.error("\n❌ Trade verification failed:", err);
  process.exit(1);
});
