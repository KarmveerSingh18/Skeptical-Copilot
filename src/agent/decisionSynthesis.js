import { GoogleGenAI } from "@google/genai";
import { generateContentWithRetry } from "./geminiRetry.js";
import { buildOutcomeContext } from "./outcomeSemantics.js";

/**
 * Decision Synthesis system prompt.
 *
 * This persona is a dispassionate decision-maker who has read BOTH the proposal
 * and the adversarial critique. It must make a concrete go/no-go call and
 * assign a calibrated confidence number that will be scored against real outcomes.
 *
 * The confidence convention is per AGENTS.md / project-spec.md §6.2:
 *   statedConfidence = probability of the PREDICTED SIDE winning.
 *   Brier score = (p - outcome)^2, where outcome = 1 if predicted side wins, 0 otherwise.
 */
const SYNTHESIS_SYSTEM_INSTRUCTION = `You are a dispassionate quantitative decision synthesizer for a DreamDEX Event Contracts trading system.
You evaluate event contract trading proposals by weighing the user's directional thesis against an adversarial Red-Team critique, live order book odds, and calculated positive expected value (+EV) edge.

CORE OBJECTIVE:
Event contract trading is designed to exploit mispricings where the assessed outcome probability exceeds the executable market ask price (Edge = Stated Probability - Executable Ask > 0).

QUANTITATIVE VALUATION & DECISION RULES:
1. MARKET PRICE ≈ 50% IS NOT EVIDENCE THAT THE THESIS IS WRONG:
   - A market implied probability near 50% (coin-flip) simply indicates that the order book is neutral.
   - When a thesis states higher conviction (e.g., 70% probability) and the market's executable ask is ~50.7%, there is a +19.3% (+0.193) gross edge.
   - You must NEVER use the market's ~50% price as evidence that the AI thesis is incorrect. The market is the counterparty offering favorable odds.
   - NEVER silently drag down the stated confidence from 70% to match the market's 52% price.

2. EVALUATING THE ADVERSARIAL RED-TEAM CRITIQUE:
   - The Red-Team is tasked to be hostile. General market risks (e.g., normal asset volatility, bid-ask spread friction, routine time decay) exist in EVERY trade.
   - APPROVE (proceed: true) when:
     * There is a positive edge (statedProbability > executableAsk).
     * The remaining time until expiry is sufficient for the thesis to hold or play out.
     * The critique presents manageable market risks rather than a fatal analytical refutation.
   - DECLINE (proceed: false) ONLY when:
     * The critique proves a FATAL analytical flaw (e.g., thesis relies on a false factual premise, immediate adverse momentum with seconds left, or spread penalty completely wipes out the edge).
     * The evidence warrants a severe downgrade such that the revised probability drops below the executable ask price (negative expected value).

3. CONFIDENCE ADJUSTMENT & MACHINE-READABLE JUSTIFICATION:
   - You must explicitly evaluate:
     * statedProbability (from thesis, e.g. 0.70)
     * executableAsk (cost to buy outcome token, e.g. 0.5070)
     * gross edge (statedProbability - executableAsk = +0.193)
     * remaining time & expiry risk
     * strength of the Red-Team critique
   - Then either:
     * Preserve or moderately adjust the confidence (e.g., 0.70 -> 0.67 due to 10m time decay risk) and APPROVE if edge remains positive.
     * Reject / downgrade the confidence with an explicit justification if the critique proves the edge does not exist.
   - You MUST provide a machine-readable, explicit explanation in the 'confidenceAdjustmentReason' field.

4. EVENT CONTRACT OUTCOME RULES:
   - UP / YES: settlementPrice >= openingPrice (or strike)
   - DOWN / NO: settlementPrice < openingPrice (or strike)
   - "DOWN" means only that settlement is below the reference/opening price. It does NOT mean price goes to $0.
   - Bearish thesis + NO is internally consistent with predicting settlementPrice < openingPrice.

OUTPUT JSON SCHEMA:
{
  "proceed": true | false,
  "side": "YES" | "NO",
  "statedConfidence": number (between 0.50 and 0.99),
  "edge": number (net edge = statedConfidence - executableAsk),
  "confidenceAdjustmentReason": "Explicit machine-readable reason explaining why confidence was preserved or downgraded against the critique and market context",
  "reasoning": "2-3 sentence synthesis explaining the go/no-go decision"
}

Respond ONLY with a single JSON object. Never include markdown fences or commentary.`;

/**
 * Decision Synthesis (LLM call #3 of 3 per AGENTS.md).
 * Standalone, independently-callable function.
 *
 * Takes the original proposal context and the adversarial critique,
 * then produces a final go/no-go decision with a calibrated confidence number.
 *
 * @param {object} proposal - { parsed, matched, recommendedSide, bookState? }
 * @param {object} critique - Output from critiqueProposal()
 * @param {object} [options] - { apiKey?, model? }
 * @returns {Promise<object>} Final decision { proceed, side, statedConfidence, edge, confidenceAdjustmentReason, reasoning }
 */
export async function synthesizeDecision(proposal, critique, options = {}) {
  if (!proposal?.parsed || !proposal?.matched) {
    throw new Error("synthesizeDecision requires proposal.parsed and proposal.matched");
  }
  if (!critique?.counterArgument) {
    throw new Error("synthesizeDecision requires a critique with counterArgument");
  }

  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment or options");
  }

  // Use the same stronger model as the critic — synthesis needs judgment depth too
  const model = options.model || process.env.GEMINI_SYNTHESIS_MODEL || "gemini-flash-latest";
  const ai = new GoogleGenAI({ apiKey });

  const { parsed, matched, recommendedSide, bookState } = proposal;

  const lastPriceNum = matched.lastPrice ? (Number(matched.lastPrice) / 1e6) : null;
  const isNo = recommendedSide === "NO";
  const sideLastPrice = lastPriceNum !== null ? (isNo ? +(1 - lastPriceNum).toFixed(4) : lastPriceNum) : null;

  const midNum = bookState?.mid ? (Number(bookState.mid) / 1e6) : null;
  const bestBidNum = bookState?.bestBid ? (Number(bookState.bestBid) / 1e6) : null;
  const bestAskNum = bookState?.bestAsk ? (Number(bookState.bestAsk) / 1e6) : null;

  const sideMid = midNum !== null ? (isNo ? +(1 - midNum).toFixed(4) : midNum) : null;
  const sideBestBid = isNo ? (bestAskNum !== null ? +(1 - bestAskNum).toFixed(4) : null) : bestBidNum;
  const sideBestAsk = isNo ? (bestBidNum !== null ? +(1 - bestBidNum).toFixed(4) : null) : bestAskNum;

  // Executable ask is the price we must pay to enter the trade immediately
  const executableAsk = sideBestAsk ?? sideLastPrice ?? sideMid ?? null;
  const marketImpliedProb = sideMid ?? sideLastPrice ?? (executableAsk !== null ? executableAsk : 0.5);

  const statedProb = typeof parsed.confidence === "number" ? parsed.confidence : null;
  const calculatedEdge = (statedProb !== null && executableAsk !== null)
    ? +(statedProb - executableAsk).toFixed(4)
    : null;

  // Build market-grounded structured outcome semantics
  const outcomeContext = buildOutcomeContext({
    asset: parsed.asset,
    strike: matched.strike ?? parsed.strike,
    openingPrice: parsed.openingPrice ?? (matched.strike && matched.strike !== "0" && matched.strike !== 0 ? matched.strike : null),
    currentPrice: parsed.currentPrice ?? null,
    recommendedSide,
    direction: parsed.direction,
  });

  const userPrompt = `TRADE PROPOSAL:
- Thesis: "${parsed.rawThesis}"
- Asset: ${parsed.asset}
- Direction: ${parsed.direction}
- Proposed Side: ${recommendedSide}
- Strike: ${parsed.strike ?? "N/A (reference opening price)"}
- Stake: ${parsed.stake ?? "unspecified"} tUSDC
- Matched Market: ${matched.symbol}
- Expiry: ${matched.expiryDate} (${matched.remainingSec}s / ${Math.round(matched.remainingSec / 60)}m remaining)

QUANTITATIVE VALUATION & EDGE EVALUATION:
- Stated Thesis Probability for ${recommendedSide}: ${statedProb !== null ? `${(statedProb * 100).toFixed(1)}% (${statedProb.toFixed(4)})` : "Not explicitly stated in text"}
- Executable Ask Price for ${recommendedSide}: ${executableAsk !== null ? `${(executableAsk * 100).toFixed(1)}% (${executableAsk.toFixed(4)})` : "N/A (no book data)"}
- Market Implied Probability for ${recommendedSide}: ${marketImpliedProb !== null ? `${(marketImpliedProb * 100).toFixed(1)}% (${marketImpliedProb.toFixed(4)})` : "50.0%"}
- Calculated Initial Edge (statedProbability - executableAsk): ${calculatedEdge !== null ? `${(calculatedEdge >= 0 ? "+" : "")}${(calculatedEdge * 100).toFixed(1)}% (${calculatedEdge.toFixed(4)})` : "N/A"}
- Best Bid for ${recommendedSide}: ${sideBestBid !== null ? sideBestBid.toFixed(4) : "none"}
- Best Ask for ${recommendedSide}: ${sideBestAsk !== null ? sideBestAsk.toFixed(4) : "none"}
- Mid Price for ${recommendedSide}: ${sideMid !== null ? sideMid.toFixed(4) : "N/A"}

${outcomeContext}

ADVERSARIAL CRITIQUE (severity ${critique.severityScore ?? "??"}/10):
"${critique.counterArgument}"

Risk Factors:
${(critique.riskFactors || []).map((r, i) => `  ${i + 1}. ${r}`).join("\n")}

Market aligned against trade: ${critique.marketAlignedAgainst ?? "unknown"}
Critic's implied YES probability: ${critique.impliedProbability ?? "unknown"}

DECISION SYNTHESIS INSTRUCTIONS:
1. Evaluate whether the gross edge (+${calculatedEdge !== null ? (calculatedEdge * 100).toFixed(1) : "??"}%) is justified after weighing the Red-Team critique and remaining time.
2. The fact that the market price is near 50% is NOT evidence the thesis is wrong — it is the source of the edge.
3. If the critique presents normal market friction rather than a fatal refutation, APPROVE the trade (proceed: true) and preserve the stated conviction (or adjust with quantitative justification).
4. Populate 'confidenceAdjustmentReason' with an explicit machine-readable explanation.`;

  const response = await generateContentWithRetry(ai, {
    model,
    contents: [
      { role: "user", parts: [{ text: userPrompt }] },
    ],
    config: {
      systemInstruction: SYNTHESIS_SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      temperature: 0.2, // low temperature for consistent, well-calibrated decisions
    },
  });

  const responseText = response.text?.trim();
  if (!responseText) {
    throw new Error("Gemini returned an empty response for synthesis");
  }

  let decision;
  try {
    decision = JSON.parse(responseText);
  } catch (err) {
    throw new Error(`Failed to parse Gemini synthesis JSON: ${err.message}. Raw: ${responseText}`);
  }

  // Validate and normalize the statedConfidence
  let confidence = typeof decision.statedConfidence === "number" ? decision.statedConfidence : 0.5;
  if (confidence < 0.5) confidence = 0.5;
  if (confidence > 0.99) confidence = 0.99;

  const finalConfidence = Math.round(confidence * 1000) / 1000;
  const netEdge = typeof decision.edge === "number"
    ? Math.round(decision.edge * 1000) / 1000
    : (executableAsk !== null ? Math.round((finalConfidence - executableAsk) * 1000) / 1000 : null);

  return {
    proceed: !!decision.proceed,
    side: decision.side === "YES" || decision.side === "NO" ? decision.side : recommendedSide,
    statedConfidence: finalConfidence,
    edge: netEdge,
    confidenceAdjustmentReason: decision.confidenceAdjustmentReason ?? "(no adjustment reason returned)",
    reasoning: decision.reasoning ?? "(no reasoning returned)",
    model,
  };
}
