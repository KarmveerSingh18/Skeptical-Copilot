import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";

process.loadEnvFile(".env");

if (!process.env.PRIVATE_KEY) {
  console.error("Error: PRIVATE_KEY not found in .env");
  process.exit(1);
}

/**
 * Standard SDK-native redemption flow:
 * 1. Query client.getClaimable(account) to identify settled/voided positions with claimable payouts.
 * 2. If claimable positions exist, batch redeem them via trader.redeemMany({ entries }).
 *
 * This avoids any manual registration of expired/finalized markets into internal registry state.
 */
async function main() {
  console.log("=== Refactored Redemption Verification (getClaimable + redeemMany) ===\n");

  const exchange = new SomniaMarkets({
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    chain: somniaShannon,
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    addresses: SOMNIA_TESTNET_ADDRESSES,
    privateKey: process.env.PRIVATE_KEY,
    fees: {
      maxFeePerGas: 15_000_000_000n,
      maxPriorityFeePerGas: 0n,
    },
  });

  exchange.signerConfig.gas = 2_000_000n;

  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  console.log(`Wallet Address: ${account.address}`);

  const targetMarketId = "0x000000000000000000000000000000000000000000000000000000000001296a";
  console.log(`Target Settled Market ID: ${targetMarketId}`);

  // 1. Query claimable positions via client.getClaimable(account)
  console.log("\nCalling exchange.client.getClaimable(walletAddress)...");
  const claimable = await exchange.client.getClaimable(account.address);

  console.log(`Total claimable positions found: ${claimable.length}`);
  if (claimable.length > 0) {
    console.log(JSON.stringify(claimable, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  } else {
    console.log("Claimable list: []");
  }

  // 2. Sanity check: confirm target market is not in claimable list (already redeemed)
  const targetClaim = claimable.find(
    c => c.marketId.toLowerCase() === targetMarketId.toLowerCase()
  );

  console.log("\n--- Sanity Check on Target Traded Market ---");
  if (!targetClaim) {
    console.log(`✅ Target market ${targetMarketId} has claimable = 0 / omitted.`);
    console.log("   Reason: Winning shares were already burned for collateral in the previous redemption.");
  } else {
    console.log(`⚠️ Target market still has claimable position:`, targetClaim);
  }

  // 3. Documented redeemMany execution path
  if (claimable.length > 0) {
    console.log(`\nFound ${claimable.length} claimable position(s). Submitting trader.redeemMany()...`);
    const entries = claimable.map(c => ({
      marketId: c.marketId,
      outcomeIdx: c.outcomeIdx,
      amount: c.amount,
    }));

    const txResult = await exchange.trader.redeemMany({ entries });
    console.log(`Batch Redeem Tx Hash: ${txResult.hash}`);
    console.log(`Status: ${txResult.receipt?.status}`);
  } else {
    console.log("\n✅ No unredeemed settled positions remaining. Zero transactions sent; zero funds moved.");
  }

  await exchange.close();
}

main().catch(err => {
  console.error("\n❌ Refactored redemption check failed:", err);
  process.exit(1);
});
