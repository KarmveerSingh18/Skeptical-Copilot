import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOG_PATH = join(__dirname, "..", "..", "data", "trades.json");

/**
 * Read all TradeRecords from the log file.
 * @param {string} [path] - Override path to the trades JSON file.
 * @returns {Array<object>} Array of TradeRecord objects.
 */
export function readTradeLog(path = DEFAULT_LOG_PATH) {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

/**
 * Append a TradeRecord to the log file.
 * Creates the data directory and file if they don't exist.
 *
 * Fields per project-spec.md §6.2:
 *   marketId, thesis, proposedSide, criticSummary, statedConfidence,
 *   stake, txHash, placedAt, expiry, outcome?, resolvedAt?
 *
 * @param {object} record - A TradeRecord to log.
 * @param {string} [path] - Override path to the trades JSON file.
 */
export function appendTradeRecord(record, path = DEFAULT_LOG_PATH) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const records = readTradeLog(path);

  // Assign a sequential trade number
  record.tradeNumber = records.length + 1;

  records.push(record);
  writeFileSync(path, JSON.stringify(records, null, 2), "utf-8");
  return record;
}

/**
 * Update an existing TradeRecord by marketId (e.g. to fill in outcome after settlement).
 * @param {string} marketId - The market ID to update.
 * @param {object} updates - Fields to merge into the existing record.
 * @param {string} [path] - Override path to the trades JSON file.
 * @returns {object|null} The updated record, or null if not found.
 */
export function updateTradeRecord(marketId, updates, path = DEFAULT_LOG_PATH) {
  const records = readTradeLog(path);
  const idx = records.findIndex((r) => r.marketId === marketId);
  if (idx === -1) return null;

  records[idx] = { ...records[idx], ...updates };
  writeFileSync(path, JSON.stringify(records, null, 2), "utf-8");
  return records[idx];
}

/**
 * Build a TradeRecord from the pipeline outputs.
 * Does NOT persist — call appendTradeRecord() to save.
 *
 * @param {object} params
 * @param {object} params.parsed - Output from parseThesis()
 * @param {object} params.matched - Output from findMatchingMarket().matched
 * @param {string} params.recommendedSide - "YES" or "NO"
 * @param {object} params.critique - Output from critiqueProposal()
 * @param {object} params.decision - Output from synthesizeDecision()
 * @param {object} params.orderResult - Output from createOrder()
 * @returns {object} A TradeRecord matching §6.2
 */
export function buildTradeRecord({
  parsed,
  matched,
  recommendedSide,
  critique,
  decision,
  orderResult,
  tradableSymbol,
}) {
  const hash = orderResult?.txHash || orderResult?.info?.hash || (typeof orderResult?.id === "string" && orderResult.id.startsWith("0x") ? orderResult.id : null);
  return {
    marketId: matched.id,
    thesis: parsed.rawThesis,
    proposedSide: decision.side || recommendedSide,
    criticSummary: critique.counterArgument,
    criticSeverity: critique.severityScore,
    statedConfidence: decision.statedConfidence,
    stake: parsed.stake ?? orderResult?.amount ?? 1,
    txHash: hash,
    placedAt: orderResult?.timestamp || Date.now(),
    expiry: Number(matched.expiry),
    symbol: tradableSymbol || matched.symbol,
    fillPrice: orderResult?.price ?? null,
    amount: orderResult?.amount ?? null,
    filled: orderResult?.filled ?? null,
    status: orderResult?.status ?? null,
    // Filled in later by calibration service:
    outcome: undefined,
    resolvedAt: undefined,
  };
}
