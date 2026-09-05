import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits } from "viem";

process.loadEnvFile(".env");

if (!process.env.PRIVATE_KEY) {
  console.error("Error: PRIVATE_KEY not found in .env");
  process.exit(1);
}

async function main() {
  console.log("=== Redeeming Settled Winning Position ===\n");

  const marketId = "0x000000000000000000000000000000000000000000000000000000000001296a";
  const marketSymbol = "ETH-0-03SEP26-2050/tUSDC";

  // 1. Construct SomniaMarkets exchange with confirmed config & gas envelope
  console.log("Constructing SomniaMarkets exchange...");
  const exchange = new SomniaMarkets({
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    chain: somniaShannon,
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    addresses: SOMNIA_TESTNET_ADDRESSES,
    privateKey: process.env.PRIVATE_KEY,
    fees: {
      maxFeePerGas: 15_000_000_000n, // 15 gwei ceiling
      maxPriorityFeePerGas: 0n,
    },
  });

  exchange.signerConfig.gas = 2_000_000n;

  // 2. Load markets and register the settled binary market
  console.log("Calling loadMarkets()...");
  await exchange.loadMarkets();

  const bm = await exchange.client.getBinaryMarket(marketId);
  if (!bm) {
    throw new Error(`Could not find BinaryMarket ${marketId}`);
  }

  // Register the settled market into exchange registry so exchange.redeem resolves it
  exchange.registry.bySymbol.set(marketSymbol, bm);
  exchange.registry.byRef.set(marketId.toLowerCase(), marketSymbol);
  exchange.registry.byRef.set(bm.marketAddress.toLowerCase(), marketSymbol);
  exchange.markets[marketSymbol] = exchange.toUnifiedMarket(bm, marketSymbol, () => "tUSDC");

  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  const tUsdcAddress = SOMNIA_TESTNET_ADDRESSES.testUsdc ?? SOMNIA_TESTNET_ADDRESSES.collateral;

  // 3. Read current tUSDC balance first
  console.log("\nReading initial tUSDC balance...");
  const tUsdcBeforeRaw = await exchange.client.getErc20Balance(tUsdcAddress, account.address);
  const tUsdcBefore = Number(formatUnits(tUsdcBeforeRaw, 6));
  console.log(`tUSDC balance BEFORE : ${tUsdcBefore} tUSDC (${tUsdcBeforeRaw} raw)`);

  // 4. Confirm exact YES outcome-token balance via fetchBalance()
  console.log("\nQuerying wallet balances via fetchBalance()...");
  const bal = await exchange.fetchBalance();
  
  // Find the YES outcome token balance
  let winningOutcomeShares = 0;
  let holdingKey = null;

  for (const [k, v] of Object.entries(bal)) {
    if (k.includes("ETH") && k.includes("#YES") && v.total > 0) {
      winningOutcomeShares = v.total;
      holdingKey = k;
      break;
    }
  }

  // Also verify on-chain portfolio
  if (winningOutcomeShares === 0) {
    const portfolio = await exchange.client.getPortfolio(account.address);
    const pos = portfolio.positions.find(p => p.market.id.toLowerCase() === marketId.toLowerCase() && p.outcomeIndex === 0);
    if (pos) {
      winningOutcomeShares = Number(pos.balance) / 1e6;
      holdingKey = `${marketSymbol}#YES`;
    }
  }

  console.log(`Holding Key           : ${holdingKey}`);
  console.log(`YES Outcome Balance   : ${winningOutcomeShares} contracts`);

  if (winningOutcomeShares <= 0) {
    throw new Error("No winning outcome tokens available to redeem.");
  }

  // 5. Call exchange.redeem()
  console.log(`\nCalling exchange.redeem("${marketId}", ${winningOutcomeShares})...`);
  const startTime = Date.now();
  const redeemResult = await exchange.redeem(marketId, winningOutcomeShares);
  const durationMs = Date.now() - startTime;

  console.log("\n=== Full Redeem Transaction Result ===");
  console.log(`Transaction Hash : ${redeemResult.hash}`);
  console.log(`Gas Used         : ${redeemResult.info?.receipt?.gasUsed ?? "N/A"}`);
  console.log(`Status           : ${redeemResult.info?.receipt?.status ?? "success"}`);
  console.log(`Confirmed in     : ${durationMs}ms`);

  // 6. Read tUSDC balance again and compute net change
  console.log("\nReading updated tUSDC balance...");
  const tUsdcAfterRaw = await exchange.client.getErc20Balance(tUsdcAddress, account.address);
  const tUsdcAfter = Number(formatUnits(tUsdcAfterRaw, 6));
  const netChange = tUsdcAfter - tUsdcBefore;

  console.log(`tUSDC balance AFTER  : ${tUsdcAfter} tUSDC (${tUsdcAfterRaw} raw)`);
  console.log(`Net Change           : +${netChange} tUSDC`);

  await exchange.close();
  console.log("\n✅ Position successfully redeemed!");
}

main().catch(err => {
  console.error("\n❌ Redemption failed:", err);
  process.exit(1);
});
