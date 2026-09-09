import { GoogleGenAI } from "@google/genai";
import { generateContentWithRetry } from "./geminiRetry.js";

/**
 * System prompt with worked examples instructing Gemini to extract structured prediction
 * parameters from free-text trade theses.
 */
const SYSTEM_INSTRUCTION = `You are a financial thesis parser for DreamDEX Event Contracts prediction markets.
Your only job is to extract structured trading parameters from free-form user statements into valid JSON.

You must extract the following fields:
- asset: The underlying asset ticker in uppercase (e.g., "BTC", "ETH", "SOL"). If no asset can be determined, return null.
- direction: The predicted direction relative to the strike or opening level:
  - "up": Bullish outcome (expects price to rise, hold above opening/strike, pump, break higher, YES on above-strike/opening).
  - "down": Bearish outcome (expects price to drop, fail to hold, stay below opening/strike, dump, break lower, crash, NO on above-strike/opening).
  - If ambiguous or indeterminate, return null.
- targetTimeframe: The user's explicit or implicit timeframe as phrased (e.g. "15m", "1 hour", "by Friday", "end of day", "next 5 minutes"). If NO timeframe is specified or implied, return null.
- targetSeconds: Estimated duration in seconds from now until the target expiry if inferrable:
  - "1m" / "1 minute" -> 60
  - "5m" / "5 minutes" -> 300
  - "15m" / "15 minutes" -> 900
  - "1h" / "1 hour" -> 3600
  - "4h" / "4 hours" -> 14400
  - "24h" / "1 day" / "by tomorrow" -> 86400
  - "by Friday" -> estimate based on days until Friday (or null if context is insufficient)
  - If unspecified or completely open-ended, return null.
- strike: Numeric price target or strike level mentioned (e.g. 65000, 2800), or null if not mentioned.
- openingPrice: Numeric opening price or reference level mentioned (e.g. 65000 in "below the opening price of 65000"), or null if not mentioned.
- currentPrice: Numeric current price mentioned (e.g. 64200 in "BTC is currently at 64200"), or null if not mentioned.
- stake: Numeric position size or dollar amount to risk if mentioned (e.g. 10, 50), or null if not mentioned.
- confidence: Stated confidence percentage (0 to 1) if mentioned, or null.
- ambiguityNotes: A short string explaining any missing or ambiguous fields (e.g. "No timeframe provided", "No stake specified"), or null if clear.

Worked Examples:

Example 1:
Input: "BTC won't hold above 65k by Friday"
Output:
{
  "asset": "BTC",
  "direction": "down",
  "targetTimeframe": "by Friday",
  "targetSeconds": 172800,
  "strike": 65000,
  "openingPrice": null,
  "currentPrice": null,
  "stake": null,
  "confidence": null,
  "ambiguityNotes": "Specific strike $65,000 and target day stated; stake unspecified."
}

Example 2:
Input: "ETH will pump past 2800 in the next 15 minutes, betting $25"
Output:
{
  "asset": "ETH",
  "direction": "up",
  "targetTimeframe": "next 15 minutes",
  "targetSeconds": 900,
  "strike": 2800,
  "openingPrice": null,
  "currentPrice": null,
  "stake": 25,
  "confidence": null,
  "ambiguityNotes": null
}

Example 3:
Input: "BTC is at 64200 below the opening price of 65000 and I expect it to stay below for the next 15 minutes"
Output:
{
  "asset": "BTC",
  "direction": "down",
  "targetTimeframe": "next 15 minutes",
  "targetSeconds": 900,
  "strike": null,
  "openingPrice": 65000,
  "currentPrice": 64200,
  "stake": null,
  "confidence": null,
  "ambiguityNotes": null
}

Example 4:
Input: "Bitcoin is going to crash"
Output:
{
  "asset": "BTC",
  "direction": "down",
  "targetTimeframe": null,
  "targetSeconds": null,
  "strike": null,
  "openingPrice": null,
  "currentPrice": null,
  "stake": null,
  "confidence": null,
  "ambiguityNotes": "Deliberately ambiguous: no timeframe, no strike, no stake specified."
}

Always respond ONLY with a single JSON object matching this schema.`;

/**
 * Thesis Parser (LLM call #1 of 3 per AGENTS.md).
 * Standalone, independently-callable function.
 *
 * @param {string} thesisText - The free-text input from the user.
 * @param {object} [options] - Optional configurations (apiKey, model).
 * @returns {Promise<object>} Structured parsed parameters.
 */
export async function parseThesis(thesisText, options = {}) {
  if (!thesisText || typeof thesisText !== "string" || thesisText.trim() === "") {
    throw new Error("parseThesis requires a non-empty string as thesisText");
  }

  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment or options");
  }

  const model = options.model || process.env.GEMINI_PARSER_MODEL || "gemini-flash-lite-latest";
  const ai = new GoogleGenAI({ apiKey });

  const response = await generateContentWithRetry(ai, {
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: `Parse this trade thesis into structured parameters:\n"${thesisText}"` }],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const responseText = response.text?.trim();
  if (!responseText) {
    throw new Error("Gemini returned an empty response for thesis parsing");
  }

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch (err) {
    throw new Error(`Failed to parse Gemini JSON output: ${err.message}. Raw: ${responseText}`);
  }

  return {
    rawThesis: thesisText,
    asset: parsed.asset ?? null,
    direction: parsed.direction ?? null,
    targetTimeframe: parsed.targetTimeframe ?? null,
    targetSeconds: typeof parsed.targetSeconds === "number" ? parsed.targetSeconds : null,
    strike: typeof parsed.strike === "number" ? parsed.strike : null,
    openingPrice: typeof parsed.openingPrice === "number" ? parsed.openingPrice : null,
    currentPrice: typeof parsed.currentPrice === "number" ? parsed.currentPrice : null,
    stake: typeof parsed.stake === "number" ? parsed.stake : null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    ambiguityNotes: parsed.ambiguityNotes ?? null,
  };
}
