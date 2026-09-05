export const MIN_REMAINING_EXPIRY_SECONDS = 120;

export function formatLastPrice(raw) {
  if (!raw) return null;
  const num = Number(raw);
  if (isNaN(num)) return String(raw);
  const usdc = (num / 1e6).toFixed(4);
  const pct = (num / 1e4).toFixed(1);
  return `${raw} (${usdc} tUSDC / ${pct}% YES)`;
}

/**
 * Matches structured thesis parameters against currently live BinaryMarkets from the SDK.
 *
 * @param {import("@somnia-chain/markets-sdk").SomniaMarkets} exchange
 * @param {object} parsed - The parsed output from parseThesis
 * @param {object} [options] - Configuration options (e.g. minRemainingSeconds)
 * @returns {Promise<object>} The matching market outcome and candidate details
 */
export async function findMatchingMarket(exchange, parsed, options = {}) {
  if (!parsed || !parsed.asset) {
    return {
      success: false,
      market: null,
      reason: "No asset specified in parsed thesis",
      candidates: [],
    };
  }

  const minRemainingSec = options.minRemainingSeconds ?? MIN_REMAINING_EXPIRY_SECONDS;

  // Fetch live binary markets from SDK
  const allLive = await exchange.client.listLiveBinaryMarkets();
  const now = Math.floor(Date.now() / 1000);

  // Filter for matching asset and non-expired markets (at least minRemainingSec remaining)
  const assetUpper = parsed.asset.toUpperCase();
  const matchingAssetMarkets = allLive.filter((m) => {
    const isSameAsset = m.asset?.toUpperCase() === assetUpper;
    const remaining = Number(m.expiry) - now;
    return isSameAsset && remaining >= minRemainingSec;
  });

  if (matchingAssetMarkets.length === 0) {
    const availableAssets = [...new Set(allLive.map((m) => m.asset))];
    return {
      success: false,
      market: null,
      reason: `No active live markets found for asset ${parsed.asset} with >= ${minRemainingSec}s remaining. Available live assets: ${availableAssets.join(", ") || "none"}`,
      candidates: [],
    };
  }

  // Ensure exchange has freshly registered markets if any new markets appeared
  const resolveTradableSymbol = (m) => {
    try {
      const t = exchange.market(m.id);
      if (t?.symbol) return t.symbol;
    } catch {
      // Not yet in local registry, format according to spec §5.1 standard
    }
    const date = new Date(Number(m.expiry) * 1000);
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
    const year = String(date.getUTCFullYear()).slice(2);
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const mins = String(date.getUTCMinutes()).padStart(2, "0");
    const expiryStr = `${day}${month}${year}-${hours}${mins}`;
    return `${m.asset}-${m.strike || 0}-${expiryStr}/tUSDC#YES`;
  };

  // Evaluate candidate markets
  const candidates = matchingAssetMarkets.map((m) => {
    const expirySec = Number(m.expiry);
    const remainingSec = expirySec - now;
    const tradableSymbol = resolveTradableSymbol(m);

    let deltaSec = null;
    if (parsed.targetSeconds !== null && parsed.targetSeconds !== undefined) {
      const targetTimestamp = now + parsed.targetSeconds;
      deltaSec = Math.abs(expirySec - targetTimestamp);
    }

    return {
      market: m,
      id: m.id,
      asset: m.asset,
      strike: m.strike,
      expiry: m.expiry,
      expiryDate: new Date(expirySec * 1000).toISOString(),
      interval: m.interval || `${Math.round(remainingSec / 60)}m`,
      intervalSec: m.intervalSec,
      remainingSec,
      deltaSec,
      tradableSymbol,
      lastPrice: m.lastPrice,
      lastPriceFormatted: formatLastPrice(m.lastPrice),
    };
  });

  // If timeframe is specified, sort by closest expiry to target timestamp
  if (parsed.targetSeconds !== null && parsed.targetSeconds !== undefined) {
    candidates.sort((a, b) => a.deltaSec - b.deltaSec);
    const best = candidates[0];

    return {
      success: true,
      market: best.market,
      matched: {
        id: best.id,
        symbol: best.tradableSymbol,
        asset: best.asset,
        strike: best.strike,
        expiry: best.expiry,
        expiryDate: best.expiryDate,
        interval: best.interval,
        remainingSec: best.remainingSec,
        deltaFromTargetSec: best.deltaSec,
        lastPrice: best.lastPrice,
        lastPriceFormatted: best.lastPriceFormatted,
      },
      recommendedSide: parsed.direction === "down" ? "NO" : "YES",
      uncertainty: null,
      totalCandidates: candidates.length,
      candidatesSummary: candidates.map((c) => ({
        symbol: c.tradableSymbol,
        interval: c.interval,
        remaining: `${Math.round(c.remainingSec / 60)}m (${c.remainingSec}s)`,
        delta: `${Math.round(c.deltaSec / 60)}m`,
        lastPrice: c.lastPriceFormatted || "(no fill)",
      })),
    };
  }

  // If timeframe is ambiguous or unspecified:
  // Sort by soonest expiry, but explicitly record uncertainty and show candidates
  candidates.sort((a, b) => a.remainingSec - b.remainingSec);
  const fallback = candidates[0];

  return {
    success: true,
    market: fallback.market,
    matched: {
      id: fallback.id,
      symbol: fallback.tradableSymbol,
      asset: fallback.asset,
      strike: fallback.strike,
      expiry: fallback.expiry,
      expiryDate: fallback.expiryDate,
      interval: fallback.interval,
      remainingSec: fallback.remainingSec,
      deltaFromTargetSec: null,
      lastPrice: fallback.lastPrice,
      lastPriceFormatted: fallback.lastPriceFormatted,
    },
    recommendedSide: parsed.direction === "down" ? "NO" : "YES",
    uncertainty: `Ambiguous timeframe in thesis: no target expiry or duration extracted. Defaulted to closest active market with >= ${minRemainingSec}s remaining (${fallback.interval || fallback.remainingSec + "s"}).`,
    totalCandidates: candidates.length,
    candidatesSummary: candidates.map((c) => ({
      symbol: c.tradableSymbol,
      interval: c.interval,
      remaining: `${Math.round(c.remainingSec / 60)}m (${c.remainingSec}s)`,
      lastPrice: c.lastPriceFormatted || "(no fill)",
    })),
  };
}
