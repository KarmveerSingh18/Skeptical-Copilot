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
const SYNTHESIS_SYSTEM_INSTRUCTION = `You are a dispassionate decision synthesizer for an event-contract trading system.
You have been given:
1. A trade proposal — a thesis about where an asset's price will go.
2. An adversarial critique — a hostile counter-argument attacking that proposal.
3. Live order-book context (current mid price, best bid/ask, time to settlement).

Your job is to weigh both sides impartially and output a final decision.
You are NOT a cheerleader for the trade. You are NOT the critic. You are the judge.

Key Decision Rules:
- proceed: boolean — true if the trade should be executed, false if the critique
  proves there is a fatal analytical error, destructive mispricing, or unaddressed structural flaw.
  When the thesis aligns with market conditions, has sufficient time before expiry (not a terminal theta decay trap), and takes a reasonable probabilistic position without hallucinating impossible edges, approve the trade (proceed: true) and express your true calibrated outcome probability in statedConfidence.
  Remember: trading is inherently probabilistic — a valid thesis does not require certainty or an inflated edge to be tradeable; a sensible, well-grounded thesis with manageable downside should be approved. Decline (proceed: false) when the critique identifies fatal, unmanaged risks (e.g. trading directly against extreme adverse odds with no time left, severe spread penalty, or factual contradiction with the live book).
- side: "YES" or "NO" — the side you recommend if proceeding (even if proceed
  is false, state which side you would have taken). This must match the
  OUTCOME SEMANTICS provided in the prompt — refer to that section to
  understand what YES and NO mean for this specific market question.
- statedConfidence: number between 0.50 and 0.99 — the probability you assign to
  the PREDICTED SIDE (the 'side' field above) actually winning this specific
  binary market. This is NOT your confidence in your analysis — it's your
  probability estimate for the outcome. Convention:
    - 0.50 = pure coin flip, no edge
    - 0.55-0.65 = sensible probabilistic position / moderate edge
    - 0.70-0.79 = strong conviction
    - 0.80+ = extreme conviction (use sparingly — you will be Brier-scored)
  Be well-calibrated. Over-confident predictions that turn out wrong will tank your
  calibration score.
- reasoning: A 2-3 sentence explanation of your decision. Explicitly reference
  which parts of the critique you found compelling or dismissed, and why.
  If proceeding, state what edge or probabilistic justification exists despite the critique.
  If declining, state which risk factor(s) tipped the balance.

IMPORTANT: Pay close attention to the OUTCOME SEMANTICS section — it tells you
exactly what YES and NO mean for this specific market's binary question. A bearish
thesis buying NO is internally consistent when the market asks "Will X settle
above Y?" — NO means price ends BELOW the strike, which IS the bearish outcome.
Do NOT flag this as a contradiction.

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
 * @returns {Promise<object>} Final decision { proceed, side, statedConfidence, reasoning }
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
  const sideLastPrice = lastPriceNum !== null ? (isNo ? 1 - lastPriceNum : lastPriceNum) : null;

  const midNum = bookState?.mid ? (Number(bookState.mid) / 1e6) : null;
  const bestBidNum = bookState?.bestBid ? (Number(bookState.bestBid) / 1e6) : null;
  const bestAskNum = bookState?.bestAsk ? (Number(bookState.bestAsk) / 1e6) : null;

  const sideMid = midNum !== null ? (isNo ? +(1 - midNum).toFixed(4) : midNum) : null;
  const sideBestBid = isNo ? (bestAskNum !== null ? +(1 - bestAskNum).toFixed(4) : null) : bestBidNum;
  const sideBestAsk = isNo ? (bestBidNum !== null ? +(1 - bestBidNum).toFixed(4) : null) : bestAskNum;

  const effectiveProb = sideMid ?? sideLastPrice;

  // Build market-grounded outcome semantics to prevent YES/NO inversion
  const outcomeContext = buildOutcomeContext({
    asset: parsed.asset,
    strike: matched.strike ?? parsed.strike,
    recommendedSide,
    direction: parsed.direction,
  });

  const userPrompt = `TRADE PROPOSAL:
- Thesis: "${parsed.rawThesis}"
- Asset: ${parsed.asset}
- Direction: ${parsed.direction}
- Proposed Side: ${recommendedSide}
- Strike: ${parsed.strike ?? "N/A"}
- Stake: ${parsed.stake ?? "unspecified"} tUSDC
- Matched Market: ${matched.symbol}
- Expiry: ${matched.expiryDate} (${matched.remainingSec}s remaining)
- Implied Probability for ${recommendedSide}: ${effectiveProb !== null ? `${(effectiveProb * 100).toFixed(1)}% (${effectiveProb.toFixed(4)})` : "no fills"}
- Best Bid for ${recommendedSide}: ${sideBestBid !== null ? sideBestBid.toFixed(4) : "none"}
- Best Ask for ${recommendedSide}: ${sideBestAsk !== null ? sideBestAsk.toFixed(4) : "none"}
- Mid Price for ${recommendedSide}: ${sideMid !== null ? sideMid.toFixed(4) : "N/A"}

OUTCOME SEMANTICS (read carefully — do NOT invert these meanings):
${outcomeContext}

ADVERSARIAL CRITIQUE (severity ${critique.severityScore ?? "??"}/10):
"${critique.counterArgument}"

Risk Factors:
${(critique.riskFactors || []).map((r, i) => `  ${i + 1}. ${r}`).join("\n")}

Market aligned against trade: ${critique.marketAlignedAgainst ?? "unknown"}
Critic's implied YES probability: ${critique.impliedProbability ?? "unknown"}

Now weigh both sides and make your final decision.`;

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

  return {
    proceed: !!decision.proceed,
    side: decision.side === "YES" || decision.side === "NO" ? decision.side : recommendedSide,
    statedConfidence: Math.round(confidence * 1000) / 1000, // 3 decimal places
    reasoning: decision.reasoning ?? "(no reasoning returned)",
    model,
  };
}
