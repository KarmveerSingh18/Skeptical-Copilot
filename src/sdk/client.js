import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

let _exchangeInstance = null;

/**
 * Returns a shared SomniaMarkets exchange instance initialized for Somnia Shannon testnet.
 */
export async function getExchange(options = {}) {
  if (_exchangeInstance && !options.forceNew) {
    return _exchangeInstance;
  }

  const privateKey = options.privateKey ?? process.env.PRIVATE_KEY;

  const exchange = new SomniaMarkets({
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    chain: somniaShannon,
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    addresses: SOMNIA_TESTNET_ADDRESSES,
    ...(privateKey ? { privateKey } : {}),
    fees: {
      maxFeePerGas: 15_000_000_000n, // 15 gwei ceiling
      maxPriorityFeePerGas: 0n,      // BFT chain
    },
  });

  await exchange.loadMarkets();

  if (!options.forceNew) {
    _exchangeInstance = exchange;
  }
  return exchange;
}
