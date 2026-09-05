import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

process.loadEnvFile(".env");

async function main() {
  console.log("=== Settlement & Resolution Verification ===");
  const marketId = "0x000000000000000000000000000000000000000000000000000000000001296a";
  console.log(`Market ID: ${marketId}\n`);

  const exchange = new SomniaMarkets({
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    chain: somniaShannon,
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });

  // 1. Status History
  console.log("--- 1. getMarketStatusHistory(marketId) ---");
  const statusHistory = await exchange.client.getMarketStatusHistory(marketId);
  console.log(JSON.stringify(statusHistory, null, 2));

  // 2. Resolution details
  console.log("\n--- 2. getMarketResolution(marketId) ---");
  const resolution = await exchange.client.getMarketResolution(marketId);
  console.log("closingAnswer:", JSON.stringify(resolution.closingAnswer, null, 2));
  console.log("openingAnswer:", JSON.stringify(resolution.openingAnswer, null, 2));
  console.log("events:", JSON.stringify(resolution.events, null, 2));

  // 3. getBinaryMarket cross-check
  console.log("\n--- 3. getBinaryMarket(marketId) Cross-Check ---");
  const binaryMarket = await exchange.client.getBinaryMarket(marketId);
  console.log("winningOutcome  :", binaryMarket.winningOutcome, "(0 = YES, 1 = NO)");
  console.log("payoutNumerators:", binaryMarket.payoutNumerators);
  console.log("status          :", binaryMarket.status);
  console.log("voided          :", binaryMarket.voided);

  await exchange.close();
}

main().catch(err => {
  console.error("Error checking resolution:", err);
  process.exit(1);
});
