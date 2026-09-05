import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits } from "viem";

// Load environment variables from .env
process.loadEnvFile(".env");

if (!process.env.PRIVATE_KEY) {
  console.error("Error: PRIVATE_KEY is not set in .env");
  process.exit(1);
}

async function main() {
  console.log("=== Somnia Shannon Testnet Signer & Faucet Verification ===\n");

  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  console.log(`Wallet address: ${account.address}`);

  // (1) Construct SomniaMarkets exchange per specification (§9 config)
  //
  // Note on fees: the SDK default is 10M gas × 60 gwei = 0.6 STT envelope.
  // Our testnet wallet has 0.1 STT, so we override fees to 15 gwei and cap
  // the faucet gas to 2M (actual measured usage: ~253k).
  console.log("Constructing SomniaMarkets exchange...");
  const exchange = new SomniaMarkets({
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    chain: somniaShannon,
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    addresses: SOMNIA_TESTNET_ADDRESSES,
    privateKey: process.env.PRIVATE_KEY,
    fees: {
      maxFeePerGas: 15_000_000_000n,     // 15 gwei ceiling (testnet base ~7 gwei)
      maxPriorityFeePerGas: 0n,          // BFT chain, no tip needed
    },
  });

  const tUsdcAddress = SOMNIA_TESTNET_ADDRESSES.testUsdc ?? SOMNIA_TESTNET_ADDRESSES.collateral;
  console.log(`tUSDC Token Address: ${tUsdcAddress}`);

  // (3a) Read balance before
  console.log("\nReading initial tUSDC balance...");
  const balanceBeforeRaw = await exchange.client.getErc20Balance(tUsdcAddress, account.address);
  console.log(`tUSDC balance BEFORE: ${formatUnits(balanceBeforeRaw, 6)} tUSDC (${balanceBeforeRaw} raw)`);

  // (2) Call exchange.trader.faucet({})
  console.log("\nCalling exchange.trader.faucet({})...");
  const startTime = Date.now();
  const txResult = await exchange.trader.faucet({
    gas: 2_000_000n,   // measured actual: ~253k; 2M is a safe ceiling
  });
  const durationMs = Date.now() - startTime;

  console.log("\n=== Faucet Transaction Result ===");
  console.log(`Transaction Hash : ${txResult.hash}`);
  if (txResult.receipt) {
    console.log(`Block Number     : ${txResult.receipt.blockNumber}`);
    console.log(`Status           : ${txResult.receipt.status === 'success' || txResult.receipt.status === 1 ? 'SUCCESS (1)' : txResult.receipt.status}`);
    console.log(`Gas Used         : ${txResult.receipt.gasUsed?.toString()}`);
  }
  console.log(`Confirmed in     : ${durationMs}ms`);

  // (3b) Read balance after
  console.log("\nReading updated tUSDC balance...");
  const balanceAfterRaw = await exchange.client.getErc20Balance(tUsdcAddress, account.address);
  console.log(`tUSDC balance AFTER : ${formatUnits(balanceAfterRaw, 6)} tUSDC (${balanceAfterRaw} raw)`);

  const mintedRaw = balanceAfterRaw - balanceBeforeRaw;
  console.log(`Net Minted          : ${formatUnits(mintedRaw, 6)} tUSDC`);

  if (mintedRaw > 0n) {
    console.log("\n✅ SUCCESS: Signer, SDK, and faucet chain verified end-to-end on Shannon testnet!");
  } else {
    console.warn("\n⚠️ WARNING: Balance did not increase after faucet call.");
  }

  // Clean up
  await exchange.close();
}

main().catch(async (err) => {
  console.error("\n❌ Faucet script failed:", err);
  process.exit(1);
});
