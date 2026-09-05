/**
 * READ-ONLY live testnet probe.
 * Calls listLiveBinaryMarkets() + getBookTops() — no wallet, no orders.
 * Uses the SDK from sdk-recon/node_modules.
 */
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from
  "../../sdk-recon/node_modules/@somnia-chain/markets-sdk/dist/index.js";
import { somniaShannon } from
  "../../sdk-recon/node_modules/@somnia-chain/markets-sdk/dist/chains/index.js";

const INDEXER_URL = "https://dev.smk.somnia.host/v1/graphql";
const WS_RPC_URL  = "wss://api.infra.testnet.somnia.network/ws";

async function main() {
  console.log("=== Shannon testnet read-only probe ===\n");

  // Construct without privateKey — read-only
  const exchange = new SomniaMarkets({
    chain:      somniaShannon,
    wsRpcUrl:   WS_RPC_URL,
    indexerUrl: INDEXER_URL,
    addresses:  SOMNIA_TESTNET_ADDRESSES,
    // no privateKey
  });

  console.log("1. Calling loadMarkets()...");
  const markets = await exchange.loadMarkets();
  const syms = Object.keys(markets);
  console.log(`   Loaded ${syms.length} market symbol(s).`);
  if (syms.length > 0) console.log(`   First 3 symbols: ${syms.slice(0,3).join(", ")}`);

  console.log("\n2. Calling client.listLiveBinaryMarkets()...");
  const live = await exchange.client.listLiveBinaryMarkets();
  console.log(`   Live BinaryMarket count: ${live.length}`);

  if (live.length === 0) {
    console.log("   ⚠️  NO live markets returned. Testnet may have no active Event Contracts right now.");
  } else {
    const m = live[0];
    const nowSec = Math.floor(Date.now() / 1000);
    const expiryIn = Number(m.expiry) - nowSec;
    console.log("\n   First live market:");
    console.log(`     id:           ${m.id}`);
    console.log(`     asset:        ${m.asset}`);
    console.log(`     question:     ${m.question}`);
    console.log(`     status:       ${m.status}`);
    console.log(`     intervalSec:  ${m.intervalSec ?? "null"}`);
    console.log(`     interval:     ${m.interval ?? "null"}`);
    console.log(`     tradingStart: ${m.tradingStart}`);
    console.log(`     expiry:       ${m.expiry}  (in ${expiryIn}s)`);
    console.log(`     lastPrice:    ${m.lastPrice ?? "null (no fills yet)"}`);
    console.log(`     poolAddress:  ${m.poolAddress}`);
    console.log(`     marketAddr:   ${m.marketAddress}`);
    console.log(`     venueId:      ${m.venueId ?? "null"}`);
    console.log(`     operatorId:   ${m.operatorId ?? "null"}`);
    console.log(`     voided:       ${m.voided}`);
    console.log(`     winningOutcome: ${m.winningOutcome ?? "null (unresolved)"}`);

    console.log(`\n   All ${live.length} live markets (id, asset, interval, expiresIn):`);
    for (const mk of live) {
      const exp = Number(mk.expiry) - nowSec;
      console.log(`     ${mk.id.slice(0,12)}...  ${mk.asset}  ${mk.interval ?? mk.intervalSec ?? "?"}  exp in ${exp}s`);
    }

    console.log("\n3. Calling client.getBookTops([marketId])...");
    const tops = await exchange.client.getBookTops([m.id]);
    const top = tops[m.id.toLowerCase()];
    if (!top) {
      console.log("   No book top returned (market may have no resting orders).");
    } else {
      console.log(`   BookTop for ${m.id.slice(0,12)}...:`);
      console.log(`     bestYesBid: ${top.bestYesBid ?? "null"}`);
      console.log(`     bestYesAsk: ${top.bestYesAsk ?? "null"}`);
      console.log(`     mid:        ${top.mid ?? "null"}`);
    }
  }

  console.log("\n4. Calling client.listPastBinaryMarkets({limit:3})...");
  const past = await exchange.client.listPastBinaryMarkets({ limit: 3 });
  console.log(`   Past market count (page of 3): ${past.length}`);
  for (const p of past) {
    console.log(`     ${p.id.slice(0,12)}...  ${p.asset}  expired:${p.expiry}  winningOutcome:${p.winningOutcome ?? "null"}  voided:${p.voided}`);
  }

  await exchange.close();
  console.log("\n=== Probe complete — no orders placed ===");
}

main().catch(err => {
  console.error("PROBE FAILED:", err?.message ?? err);
  process.exit(1);
});
