/**
 * Outcome Semantics Helper
 *
 * Generates structured and human-readable context explaining what YES and NO
 * (UP and DOWN) mean for DreamDEX Event Contracts, grounded in the market's
 * actual metadata (asset, strike, openingPrice, currentPrice).
 *
 * Semantic Definitions:
 * - UP / YES:   settlementPrice >= openingPrice (or strike)
 * - DOWN / NO:  settlementPrice < openingPrice (or strike)
 *
 * Boundary Rules:
 * - "DOWN" means strictly that the settlement price ends BELOW the opening price (or strike).
 * - "DOWN" is NOT a zero-strike outcome and does NOT mean the asset price collapses to zero ($0).
 * - Agents must reason about the probability of crossing the opening price boundary,
 *   never inferring a target price of zero from the word DOWN.
 */

/**
 * Build a structured and unambiguous description of what YES/NO and UP/DOWN mean
 * for this specific binary event contract, including explicit structured fields.
 *
 * @param {object} params
 * @param {string} params.asset - e.g. "BTC", "ETH"
 * @param {string|number|null} [params.strike] - e.g. 65000, or null / 0 for reference-mode
 * @param {string|number|null} [params.openingPrice] - Opening/reference price if known
 * @param {string|number|null} [params.currentPrice] - Current asset price if known
 * @param {string} params.recommendedSide - "YES" or "NO"
 * @param {string} params.direction - "up" or "down" (from parsed thesis)
 * @returns {string} Structured outcome semantics block for LLM prompts
 */
export function buildOutcomeContext({
  asset,
  strike = null,
  openingPrice = null,
  currentPrice = null,
  recommendedSide,
  direction,
}) {
  const isDown = recommendedSide === "NO" || direction === "down";
  const outcome = isDown ? "DOWN" : "UP";

  // Determine reference boundary description and value
  const hasNumericStrike = strike != null && strike !== 0 && strike !== "0" && !isNaN(Number(strike));
  const hasNumericOpening = openingPrice != null && !isNaN(Number(openingPrice));

  let refBoundaryLabel;
  let openingPriceField;

  if (hasNumericOpening) {
    refBoundaryLabel = String(openingPrice);
    openingPriceField = String(openingPrice);
  } else if (hasNumericStrike) {
    refBoundaryLabel = String(strike);
    openingPriceField = `${strike} (fixed strike)`;
  } else {
    refBoundaryLabel = "openingPrice";
    openingPriceField = "openingPrice (set at market open / reference level)";
  }

  const settlementCondition = isDown
    ? `settlementPrice < ${refBoundaryLabel}`
    : `settlementPrice >= ${refBoundaryLabel}`;

  const marketQuestion = `Will ${asset} settle above ${refBoundaryLabel}?`;

  const structuredFields = [
    `- asset: ${asset}`,
    `- openingPrice: ${openingPriceField}`,
    currentPrice != null ? `- currentPrice: ${currentPrice}` : null,
    `- outcome: ${outcome}`,
    `- side: ${recommendedSide}`,
    `- settlementCondition: "${settlementCondition}"`,
  ].filter(Boolean).join("\n");

  const rules = [
    `SEMANTIC DEFINITIONS (DreamDEX Event Contracts):`,
    `  • UP / YES: settlementPrice >= ${refBoundaryLabel} (settles at or above opening/reference level)`,
    `  • DOWN / NO: settlementPrice < ${refBoundaryLabel} (settles below opening/reference level)`,
    ``,
    `CRITICAL BOUNDARY & RISK REASONING RULES:`,
    `  1. "DOWN" in DreamDEX Event Contracts means ONLY that settlementPrice < ${refBoundaryLabel}.`,
    `  2. "DOWN" does NOT mean ${asset} crashes to zero ($0) or collapses. There is NO zero strike.`,
    `  3. You MUST reason about the probability of the price crossing or remaining below the ${refBoundaryLabel} boundary at expiry — NEVER infer a target price of zero from the word DOWN.`,
    `  4. The proposed side is ${recommendedSide} (${outcome}). Direction: ${direction}. This is internally consistent with predicting "${settlementCondition}".`
  ].join("\n");

  return [
    `STRUCTURED MARKET & OUTCOME CONTEXT:`,
    structuredFields,
    ``,
    `Market Question: "${marketQuestion}"`,
    rules
  ].join("\n");
}
