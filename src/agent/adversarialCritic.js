import { GoogleGenAI } from "@google/genai";
import { generateContentWithRetry } from "./geminiRetry.js";
import { buildOutcomeContext } from "./outcomeSemantics.js";

/**
 * Adversarial Critic system prompt.
 *
 * This persona is a professional risk analyst whose ONLY job is to find
 * genuine reasons the proposed trade will lose money.  It is NOT a helpful
 * assistant that hedges — it is an advocate for the *opposite* side of the
 * trade, instructed to attack the thesis as hard as it can.
 */
const CRITIC_SYSTEM_INSTRUCTION = `You are a hostile, adversarial trading risk analyst for DreamDEX Event Contracts.
Your ONLY job is to construct the strongest possible argument AGAINST a proposed
event-contract trade. You are NOT a balanced advisor — you are the devil's
advocate retained specifically to find every reason this trade will fail.

You will be given:
1. A proposed trade thesis (what the trader believes will happen).
2. The matched market details (symbol, expiry, interval, implied YES probability).
3. Current order-book state (best bid/ask/mid if available, last trade price).
4. STRUCTURED MARKET & OUTCOME CONTEXT (openingPrice, outcome, settlementCondition, boundary rules).

Your output MUST be a JSON object with these fields:
- counterArgument: A 2-4 sentence aggressive counter-thesis. Attack the logic,
  timing, probability implied by the market, or hidden assumptions. Be specific —
  cite the market data you were given (e.g. "the book mid implies 74% YES but
  you're betting NO — you need the majority of participants to be wrong").
  Do NOT pad with "however, the trader may be right" — that defeats your purpose.
- riskFactors: An array of 2-4 short strings, each a distinct concrete risk
  (e.g. "Market expires in 38 minutes — insufficient time for thesis to play out",
  "Current bid/ask spread of 15% signals low liquidity and high slippage risk").
- marketAlignedAgainst: boolean — true if the current market price (lastPrice or
  mid) implies the market disagrees with the proposed trade direction. For example,
  if the proposal is to buy YES and mid is 0.30 (market says 70% NO), then the
  market agrees with YES being cheap and disagrees less. But if mid is 0.75 and
  the proposal is NO, the market IS aligned against the trade (most participants
  believe YES).
- impliedProbability: number (0–1) — your reading of what the current book state
  implies the probability of YES is. Derive from lastPrice (raw / 1e6) or mid if
  available. If no data, return null.
- severityScore: number 1–10, where 10 = "this trade is almost certainly a loss"
  and 1 = "weak objection, trade is probably fine". Be honest — don't always
  say 10. A genuine 3 is more useful than an inflated 8.

Worked Examples:

Example 1:
Proposal: BTC bearish, wants to buy NO. Market lastPrice=521000 (52.1% YES, meaning 47.9% NO).
Counter: { "counterArgument": "The market is almost exactly at a coin-flip (52% YES). Buying NO at effective 48 cents means you need BTC to drop below the strike, but the market's near-50/50 pricing says participants see no strong directional edge either way. You're paying roughly fair value for a position with zero informational advantage — transaction costs and slippage make this negative expected value.", "riskFactors": ["Near-50/50 implied probability means no mispricing to exploit", "Transaction fees consume the already-thin edge", "4h market expiry is long enough for BTC to mean-revert from any dip"], "marketAlignedAgainst": false, "impliedProbability": 0.521, "severityScore": 5 }

Example 2:
Proposal: ETH bullish, wants to buy YES. Market lastPrice=748000 (74.8% YES).
Counter: { "counterArgument": "You're buying YES at 75 cents — the market already prices a 75% chance ETH ends above the strike. You need ETH to close higher, but you're paying 3:1 for what the market considers a likely outcome. The upside is only 25 cents per share while the downside is 75 cents. You're arriving late to a consensus trade.", "riskFactors": ["Buying at 75% means risking 75 cents to gain 25 — asymmetric downside", "High implied probability means the 'easy money' is already priced in", "Any unexpected dip will cause outsized losses vs. potential gain"], "marketAlignedAgainst": false, "impliedProbability": 0.748, "severityScore": 6 }

IMPORTANT EVENT CONTRACT SEMANTIC RULES:
1. Pay close attention to the STRUCTURED MARKET & OUTCOME CONTEXT in the prompt.
2. In DreamDEX Event Contracts, binary markets resolve based on:
   - UP / YES: settlementPrice >= openingPrice (or strike)
   - DOWN / NO: settlementPrice < openingPrice (or strike)
3. "DOWN" (NO) means ONLY that the settlement price ends BELOW the opening price or strike.
4. "DOWN" does NOT mean the asset price drops to zero ($0) or suffers an existential collapse. There is NO zero strike.
5. When criticizing a DOWN / NO proposal, reason about the probability of the price crossing back above the opening price / strike boundary before expiry. NEVER claim or assume that a bearish thesis requires or predicts the asset to drop to $0.
6. A bearish thesis buying NO is internally consistent when predicting settlementPrice < openingPrice. Do NOT claim NO means going UP.

Respond ONLY with a single JSON object. Never include markdown fences or commentary.`;

/**
 * Adversarial Critic (LLM call #2 of 3 per AGENTS.md).
 * Standalone, independently-callable function.
 *
 * Takes the parsed thesis, matched market info, and current book/price state,
 * and returns a structured counter-argument attacking the proposed trade.
 *
 * @param {object} proposal - { parsed, matched, recommendedSide }
 * @param {object} bookState - { lastPrice, bestBid, bestAsk, mid } (raw strings or null)
 * @param {object} [options] - { apiKey?, model? }
 * @returns {Promise<object>} Structured critique
 */
export async function critiqueProposal(proposal, bookState, options = {}) {
  if (!proposal?.parsed || !proposal?.matched) {
    throw new Error("critiqueProposal requires proposal.parsed and proposal.matched");
  }

  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment or options");
  }

  // Use a stronger reasoning model than the parser's flash-lite
  const model = options.model || process.env.GEMINI_CRITIC_MODEL || "gemini-flash-latest";
  const ai = new GoogleGenAI({ apiKey });

  // Build the grounding context for the critic
  const { parsed, matched, recommendedSide } = proposal;
  const lastPriceNum = bookState.lastPrice ? (Number(bookState.lastPrice) / 1e6) : null;
  const midNum = bookState.mid ? (Number(bookState.mid) / 1e6) : null;
  const bestBidNum = bookState.bestBid ? (Number(bookState.bestBid) / 1e6) : null;
  const bestAskNum = bookState.bestAsk ? (Number(bookState.bestAsk) / 1e6) : null;

  const isNo = recommendedSide === "NO";
  const sideLastPrice = lastPriceNum !== null ? (isNo ? +(1 - lastPriceNum).toFixed(4) : lastPriceNum) : null;
  const sideMid = midNum !== null ? (isNo ? +(1 - midNum).toFixed(4) : midNum) : null;
  const sideBestBid = isNo ? (bestAskNum !== null ? +(1 - bestAskNum).toFixed(4) : null) : bestBidNum;
  const sideBestAsk = isNo ? (bestBidNum !== null ? +(1 - bestBidNum).toFixed(4) : null) : bestAskNum;

  const remainingSec = matched.remainingSec;
  const remainingMin = Math.round(remainingSec / 60);

  // Build market-grounded structured outcome semantics
  const outcomeContext = buildOutcomeContext({
    asset: parsed.asset,
    strike: matched.strike ?? parsed.strike,
    openingPrice: parsed.openingPrice ?? (matched.strike && matched.strike !== "0" && matched.strike !== 0 ? matched.strike : null),
    currentPrice: parsed.currentPrice ?? null,
    recommendedSide,
    direction: parsed.direction,
  });

  const userPrompt = `PROPOSED TRADE TO ATTACK:
- Thesis: "${parsed.rawThesis}"
- Asset: ${parsed.asset}
- Direction: ${parsed.direction} (user expects price to go ${parsed.direction})
- Proposed Side: ${recommendedSide} (buying ${recommendedSide} outcome tokens)
- Strike: ${parsed.strike ?? "N/A (at-the-money / reference opening price)"}
- Stake: ${parsed.stake ?? "not specified"} tUSDC

${outcomeContext}

MATCHED MARKET:
- Symbol: ${matched.symbol}
- Market ID: ${matched.id}
- Interval: ${matched.interval}
- Expiry: ${matched.expiryDate} (${remainingMin}m / ${remainingSec}s remaining)

CURRENT BOOK STATE (For proposed ${recommendedSide} tokens):
- Market Implied ${recommendedSide} Probability: ${sideLastPrice !== null ? `${(sideLastPrice * 100).toFixed(1)}% (price: ${sideLastPrice.toFixed(4)})` : "no fills yet"}
- Best Bid for ${recommendedSide}: ${sideBestBid !== null ? sideBestBid.toFixed(4) : "none"}
- Best Ask for ${recommendedSide}: ${sideBestAsk !== null ? sideBestAsk.toFixed(4) : "none"}
- Mid for ${recommendedSide}: ${sideMid !== null ? sideMid.toFixed(4) : "N/A"}
(Underlying contract YES probability: ${lastPriceNum !== null ? `${(lastPriceNum * 100).toFixed(1)}%` : "N/A"})

Construct your strongest argument against this trade. Reason about boundary crossing (settlementPrice vs openingPrice/strike), not price collapse to zero. Be specific and cite the numbers above.`;

  const response = await generateContentWithRetry(ai, {
    model,
    contents: [
      { role: "user", parts: [{ text: userPrompt }] },
    ],
    config: {
      systemInstruction: CRITIC_SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      temperature: 0.4, // some creativity for genuine counter-arguments
    },
  });

  const responseText = response.text?.trim();
  if (!responseText) {
    throw new Error("Gemini returned an empty response for critique");
  }

  let critique;
  try {
    critique = JSON.parse(responseText);
  } catch (err) {
    throw new Error(`Failed to parse Gemini critique JSON: ${err.message}. Raw: ${responseText}`);
  }

  return {
    counterArgument: critique.counterArgument ?? "(no counter-argument returned)",
    riskFactors: Array.isArray(critique.riskFactors) ? critique.riskFactors : [],
    marketAlignedAgainst: critique.marketAlignedAgainst ?? null,
    impliedProbability: typeof critique.impliedProbability === "number" ? critique.impliedProbability : null,
    severityScore: typeof critique.severityScore === "number" ? critique.severityScore : null,
    model,
  };
}
