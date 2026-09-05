import { parseThesis } from "../agent/thesisParser.js";
import { critiqueProposal } from "../agent/adversarialCritic.js";
import { synthesizeDecision } from "../agent/decisionSynthesis.js";
import { findMatchingMarket } from "./marketLookup.js";
import { buildTradeRecord, appendTradeRecord } from "../calibration/tradeLog.js";

/**
 * Full reasoning + execution pipeline.
 *
 * Runs all three LLM stages (parse → critique → synthesize), then—if the
 * synthesis says "proceed"—executes via createOrder and logs a TradeRecord.
 *
 * The `confirmGate` callback lets the caller (UI or CLI) present the reasoning
 * trail and get explicit user approval before any real order is placed.
 * If `confirmGate` is not provided or returns false, the order is NOT placed.
 *
 * @param {object} params
 * @param {string} params.thesisText - Free-text trade thesis from the user
 * @param {import("@somnia-chain/markets-sdk").SomniaMarkets} params.exchange - Initialized exchange
 * @param {function} [params.confirmGate] - async (trailData) => boolean. Called before order placement.
 * @param {number} [params.orderAmount=1] - Number of contracts to buy
 * @param {object} [params.options] - Pass-through options (model overrides, etc.)
 * @returns {Promise<object>} Full pipeline result
 */
export async function runPipeline({
  thesisText,
  exchange,
  confirmGate,
  orderAmount = 1,
  forceExecute = false,
  options = {},
}) {
  const result = {
    stages: {},
    tradeRecord: null,
    orderPlaced: false,
    declinedReason: null,
  };

  // ─── STAGE 1: Parse ────────────────────────────────────────────────────
  const t1 = Date.now();
  const parsed = await parseThesis(thesisText, options);
  result.stages.parse = {
    output: parsed,
    latencyMs: Date.now() - t1,
  };

  // ─── Market Match ──────────────────────────────────────────────────────
  const matchResult = await findMatchingMarket(exchange, parsed, options);
  result.stages.match = matchResult;

  if (!matchResult.success) {
    result.declinedReason = `Market match failed: ${matchResult.reason}`;
    return result;
  }

  const { matched, recommendedSide } = matchResult;

  // ─── Fetch Book State ──────────────────────────────────────────────────
  let bookState = { lastPrice: matched.lastPrice, bestBid: null, bestAsk: null, mid: null };
  try {
    const tops = await exchange.client.getBookTops([matched.id]);
    const top = tops[matched.id.toLowerCase()] || tops[matched.id];
    if (top) {
      bookState.bestBid = top.bestBid;
      bookState.bestAsk = top.bestAsk;
      bookState.mid = top.mid;
    }
  } catch (err) {
    // Non-fatal — proceed with lastPrice only
    result.stages.bookError = err.message;
  }
  result.stages.bookState = bookState;

  // ─── STAGE 2: Critique ─────────────────────────────────────────────────
  const proposal = { parsed, matched, recommendedSide };
  const t2 = Date.now();
  const critique = await critiqueProposal(proposal, bookState, options);
  result.stages.critique = {
    output: critique,
    latencyMs: Date.now() - t2,
  };

  // ─── STAGE 3: Synthesis ────────────────────────────────────────────────
  const t3 = Date.now();
  const decision = await synthesizeDecision({ ...proposal, bookState }, critique, options);
  result.stages.synthesis = {
    output: decision,
    latencyMs: Date.now() - t3,
  };

  // ─── Decision Gate ─────────────────────────────────────────────────
  if (!decision.proceed) {
    if (forceExecute) {
      console.warn(`[Pipeline] Synthesis declined but forceExecute=true — overriding gate.`);
      console.warn(`[Pipeline] Synthesis reasoning: ${decision.reasoning}`);
    } else {
      result.declinedReason = `Synthesis declined: ${decision.reasoning}`;
      return result;
    }
  }

  // ─── Confirm Gate (user/UI approval) ───────────────────────────────────
  if (confirmGate) {
    const approved = await confirmGate({
      parsed,
      matched,
      recommendedSide,
      critique,
      decision,
      bookState,
    });
    if (!approved) {
      result.declinedReason = "User declined after reviewing reasoning trail";
      return result;
    }
  }

  // ─── Execute Order ─────────────────────────────────────────────────────
  const targetSide = decision.side || recommendedSide || "YES";
  const tradableSymbol = targetSide === "NO"
    ? matched.symbol.replace(/#YES$/i, "#NO")
    : matched.symbol.replace(/#NO$/i, "#YES");

  const placed = await exchange.createOrder(
    tradableSymbol,
    "market",
    "buy",
    orderAmount,
  );

  // Confirm fill via watchOrders if still open
  let orderResult = placed;
  if (placed.status === "open") {
    while (orderResult.status === "open") {
      const orders = await exchange.watchOrders(tradableSymbol);
      const mine = orders.find((o) => o.id === placed.id);
      if (!mine || mine.status !== "open") {
        orderResult = mine || orderResult;
        break;
      }
      orderResult = mine;
    }
  }

  result.stages.order = orderResult;
  result.orderPlaced = true;

  // ─── Log TradeRecord ───────────────────────────────────────────────────
  const tradeRecord = buildTradeRecord({
    parsed,
    matched,
    recommendedSide,
    critique,
    decision,
    orderResult,
    tradableSymbol,
  });

  appendTradeRecord(tradeRecord);
  result.tradeRecord = tradeRecord;

  return result;
}
