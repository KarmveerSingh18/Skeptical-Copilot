/**
 * Outcome Semantics Helper
 *
 * Generates human-readable context strings that explain what YES and NO mean
 * for a specific binary market question, grounded in the market's actual
 * metadata (asset, strike).
 *
 * This eliminates the ambiguity that caused the adversarial critic to invert
 * YES/NO semantics (e.g. claiming "NO means BTC goes UP").
 */

/**
 * Build a clear, unambiguous description of what YES and NO mean for this
 * specific binary market, plus how the proposed side maps to the trader's
 * directional thesis.
 *
 * @param {object} params
 * @param {string} params.asset - e.g. "BTC", "ETH"
 * @param {string|number|null} params.strike - e.g. 65000, or null for at-the-money
 * @param {string} params.recommendedSide - "YES" or "NO"
 * @param {string} params.direction - "up" or "down" (from parsed thesis)
 * @returns {string} Human-readable outcome semantics block for LLM prompts
 */
export function buildOutcomeContext({ asset, strike, recommendedSide, direction }) {
  const strikeLabel = strike != null ? String(strike) : "the opening/reference level";
  const marketQuestion = `Will ${asset} settle above ${strikeLabel}?`;

  const yesDesc = `YES = price ends ABOVE ${strikeLabel} (bullish outcome)`;
  const noDesc = `NO = price ends BELOW ${strikeLabel} (bearish outcome)`;

  const sideExplanation = recommendedSide === "NO"
    ? `The proposed side is NO, meaning the trader expects a BEARISH outcome (${asset} settles BELOW ${strikeLabel}).`
    : `The proposed side is YES, meaning the trader expects a BULLISH outcome (${asset} settles ABOVE ${strikeLabel}).`;

  const directionCheck = direction === "down"
    ? `The trader's thesis is bearish (direction: down). This is consistent with buying NO — both predict the price will end below the strike.`
    : `The trader's thesis is bullish (direction: up). This is consistent with buying YES — both predict the price will end above the strike.`;

  return [
    `Market Question: "${marketQuestion}"`,
    yesDesc,
    noDesc,
    sideExplanation,
    directionCheck,
  ].join("\n");
}
