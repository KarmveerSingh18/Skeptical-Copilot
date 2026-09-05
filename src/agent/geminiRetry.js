/**
 * Robust wrapper for Gemini API calls with automatic retry on 503 (high demand) or 429.
 */
export async function generateContentWithRetry(ai, params, maxRetries = 5) {
  let currentParams = { ...params };
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await ai.models.generateContent(currentParams);
    } catch (err) {
      const msg = err?.message || "";
      const isRetryable =
        err?.status === 503 ||
        err?.status === 429 ||
        msg.includes("high demand") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("RESOURCE_EXHAUSTED");

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      // If flash-latest is persistently busy after 2 attempts, fallback to flash-lite-latest
      if (attempt >= 2 && currentParams.model === "gemini-flash-latest") {
        console.warn(`[Gemini API] Switching to fallback model 'gemini-flash-lite-latest' due to high demand on ${currentParams.model}...`);
        currentParams.model = "gemini-flash-lite-latest";
      }

      const delayMs = attempt * 2500;
      console.warn(`[Gemini API] Temporary error (${err?.status || "busy"}), retrying in ${delayMs / 1000}s (attempt ${attempt}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
