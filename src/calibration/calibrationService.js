import { readTradeLog, updateTradeRecordByNumber } from "./tradeLog.js";

/**
 * Compute the Brier score for a single trade.
 *
 * Per AGENTS.md and project-spec.md §6.2:
 *   statedConfidence = probability of the PREDICTED SIDE winning (0.50 - 0.99)
 *   outcome = 1 if predicted side won, 0 if it lost
 *   Brier score = (statedConfidence - outcome)^2
 *
 * Perfect prediction: 0.0
 * Worst prediction: 1.0
 * Coin flip at 0.50: 0.25
 *
 * @param {number} statedConfidence - Stated probability for the proposed side (0.50 - 1.0)
 * @param {number|string} outcome - 1 (win), 0 (loss), or "voided"
 * @returns {number|null} Brier score (0.0 to 1.0) or null if not scorable
 */
export function computeBrierScore(statedConfidence, outcome) {
  if (outcome !== 0 && outcome !== 1) return null;
  if (typeof statedConfidence !== "number" || isNaN(statedConfidence)) return null;

  const score = Math.pow(statedConfidence - outcome, 2);
  return Math.round(score * 10000) / 10000;
}

/**
 * Check if a specific binary market has settled via the Somnia Markets SDK.
 *
 * Reads winningOutcome and settlement metadata directly from getBinaryMarket.
 * Confirmed SDK fields (docs/project-spec.md §5.8 & markets.d.ts):
 *   market.winningOutcome: 0 = YES, 1 = NO, null = unresolved
 *   market.voided: boolean
 *   market.resolvedAtTimestamp: unix seconds string or null
 *
 * @param {import("@somnia-chain/markets-sdk").SomniaMarkets} exchange
 * @param {string} marketId
 * @returns {Promise<object>} Settlement status object
 */
export async function checkMarketSettlement(exchange, marketId) {
  if (!exchange?.client) {
    throw new Error("checkMarketSettlement requires an initialized exchange instance");
  }

  const market = await exchange.client.getBinaryMarket(marketId);
  if (!market) {
    return {
      marketId,
      found: false,
      isSettled: false,
      winningOutcome: null,
      voided: false,
      resolvedAt: null,
      expiry: null,
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expirySec = Number(market.expiry);
  const isSettled = market.winningOutcome !== null || market.voided === true;
  const resolvedAt = market.resolvedAtTimestamp
    ? Number(market.resolvedAtTimestamp) * 1000
    : (isSettled ? Date.now() : null);

  return {
    marketId,
    found: true,
    symbol: market.symbol,
    asset: market.asset,
    isSettled,
    winningOutcome: market.winningOutcome, // 0 = YES, 1 = NO, or null
    voided: !!market.voided,
    payoutNumerators: market.payoutNumerators ?? null,
    resolvedAt,
    expiry: expirySec,
    isExpired: nowSec >= expirySec,
    remainingSec: Math.max(0, expirySec - nowSec),
  };
}

/**
 * Poll all open TradeRecords from data/trades.json and update settled ones.
 *
 * HARD CONSTRAINT (AGENTS.md):
 *   Derives settlement and calibration data ONLY from our own recorded TradeRecords.
 *
 * @param {import("@somnia-chain/markets-sdk").SomniaMarkets} exchange
 * @param {object} [options]
 * @param {string} [options.logPath] - Optional custom path for trades.json
 * @returns {Promise<object>} Summary of polled trades and updates
 */
export async function pollSettledTrades(exchange, options = {}) {
  const logPath = options.logPath;
  const allTrades = readTradeLog(logPath);

  const openTrades = allTrades.filter(
    (t) => t.outcome === undefined || t.outcome === null
  );

  const results = {
    totalTrades: allTrades.length,
    openTradesCount: openTrades.length,
    checkedMarkets: [],
    newlySettled: [],
    stillOpen: [],
  };

  for (const trade of openTrades) {
    const settlement = await checkMarketSettlement(exchange, trade.marketId);
    results.checkedMarkets.push({
      tradeNumber: trade.tradeNumber,
      marketId: trade.marketId,
      symbol: trade.symbol,
      proposedSide: trade.proposedSide,
      isSettled: settlement.isSettled,
      remainingSec: settlement.remainingSec,
      winningOutcome: settlement.winningOutcome,
    });

    if (settlement.isSettled) {
      let outcome;
      if (settlement.voided) {
        outcome = "voided";
      } else if (settlement.winningOutcome === 0) {
        // 0 = YES won
        outcome = trade.proposedSide === "YES" ? 1 : 0;
      } else if (settlement.winningOutcome === 1) {
        // 1 = NO won
        outcome = trade.proposedSide === "NO" ? 1 : 0;
      } else {
        outcome = "voided";
      }

      const resolvedAt = settlement.resolvedAt || Date.now();
      const updated = updateTradeRecordByNumber(
        trade.tradeNumber,
        { outcome, resolvedAt },
        logPath
      );

      results.newlySettled.push({
        tradeNumber: trade.tradeNumber,
        marketId: trade.marketId,
        proposedSide: trade.proposedSide,
        winningOutcome: settlement.winningOutcome,
        outcome,
        brierScore: computeBrierScore(trade.statedConfidence, outcome),
        updatedRecord: updated,
      });
    } else {
      results.stillOpen.push({
        tradeNumber: trade.tradeNumber,
        marketId: trade.marketId,
        symbol: trade.symbol,
        expiry: trade.expiry,
        remainingSec: settlement.remainingSec,
      });
    }
  }

  // Refresh records and compute calibration summary
  const refreshedTrades = readTradeLog(logPath);
  results.calibrationSummary = computeCalibrationSummary(refreshedTrades);

  return results;
}

/**
 * Compute the full calibration summary and confidence bucket breakdown.
 *
 * HARD CONSTRAINT (AGENTS.md):
 *   Derives calibration data ONLY from our own recorded TradeRecords.
 *
 * @param {Array<object>} tradeRecords - Array of TradeRecord objects from tradeLog.js
 * @returns {object} Calibration summary with overall Brier score and bucket breakdown
 */
export function computeCalibrationSummary(tradeRecords = []) {
  const settled = tradeRecords.filter(
    (t) => t.outcome === 0 || t.outcome === 1
  );
  const open = tradeRecords.filter(
    (t) => t.outcome === undefined || t.outcome === null
  );
  const voided = tradeRecords.filter((t) => t.outcome === "voided");

  // Calculate Brier scores for all settled trades
  const scorableTrades = settled.map((t) => {
    const brier = computeBrierScore(t.statedConfidence, t.outcome);
    return {
      tradeNumber: t.tradeNumber,
      symbol: t.symbol,
      proposedSide: t.proposedSide,
      statedConfidence: t.statedConfidence,
      outcome: t.outcome,
      brierScore: brier,
    };
  });

  const overallBrierScore =
    scorableTrades.length > 0
      ? Math.round(
          (scorableTrades.reduce((acc, t) => acc + t.brierScore, 0) /
            scorableTrades.length) *
            10000
        ) / 10000
      : null;

  const totalWins = settled.filter((t) => t.outcome === 1).length;
  const overallWinRate =
    settled.length > 0
      ? Math.round((totalWins / settled.length) * 1000) / 1000
      : null;

  const overallMeanConfidence =
    settled.length > 0
      ? Math.round(
          (settled.reduce((acc, t) => acc + t.statedConfidence, 0) /
            settled.length) *
            1000
        ) / 1000
      : null;

  // Define confidence buckets
  const bucketDefs = [
    { label: "50-59%", min: 0.50, max: 0.599 },
    { label: "60-69%", min: 0.60, max: 0.699 },
    { label: "70-79%", min: 0.70, max: 0.799 },
    { label: "80-89%", min: 0.80, max: 0.899 },
    { label: "90-100%", min: 0.90, max: 1.00 },
  ];

  const buckets = bucketDefs.map((b) => {
    const tradesInBucket = scorableTrades.filter(
      (t) => t.statedConfidence >= b.min && t.statedConfidence <= b.max
    );
    const openInBucket = open.filter(
      (t) => t.statedConfidence >= b.min && t.statedConfidence <= b.max
    );

    const count = tradesInBucket.length;
    const wins = tradesInBucket.filter((t) => t.outcome === 1).length;
    const actualWinRate = count > 0 ? Math.round((wins / count) * 1000) / 1000 : null;
    const meanConfidence =
      count > 0
        ? Math.round(
            (tradesInBucket.reduce((acc, t) => acc + t.statedConfidence, 0) /
              count) *
              1000
          ) / 1000
        : null;

    const brierScore =
      count > 0
        ? Math.round(
            (tradesInBucket.reduce((acc, t) => acc + t.brierScore, 0) / count) *
              10000
          ) / 10000
        : null;

    const calibrationError =
      meanConfidence !== null && actualWinRate !== null
        ? Math.round((meanConfidence - actualWinRate) * 1000) / 1000
        : null;

    return {
      bucket: b.label,
      range: [b.min, b.max],
      count,
      openCount: openInBucket.length,
      meanConfidence,
      actualWinRate,
      brierScore,
      calibrationError, // > 0: overconfident, < 0: underconfident
    };
  });

  return {
    totalTrades: tradeRecords.length,
    settledTrades: settled.length,
    openTrades: open.length,
    voidedTrades: voided.length,
    overallBrierScore,
    overallWinRate,
    overallMeanConfidence,
    scorableTrades,
    buckets,
  };
}
