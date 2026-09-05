# AGENTS.md — Skeptical Copilot + Calibration Tracker

## Before planning or writing any code
Read `docs/project-spec.md` in full. It contains the confirmed
`@somnia-chain/markets-sdk` API surface (Section 5) — every method there was
read directly from the installed package's `.d.ts` files, not guessed.

## Hard constraints (always apply)
- Event Contracts only. Never build spot/perp features — off-theme for this
  hackathon regardless of what seems technically convenient.
- **First milestone before anything else**: one complete end-to-end testnet
  loop — discover a live `BinaryMarket`, place one order via `createOrder`,
  confirm the fill, poll to settlement, record the outcome. Do not start the
  LLM reasoning pipeline, UI, or calibration service until this loop is
  verified working. Stop and report back once it works.
- Keep the three reasoning steps — thesis parser, adversarial critic,
  decision synthesis — as separate, independently-callable functions. Never
  collapse them into one LLM call. LLM reasoning uses the Gemini API (free tier, GEMINI_API_KEY).
- Log every field of `TradeRecord` (spec §6.2) starting with trade #1.
- `statedConfidence` = probability of the *predicted side*. Brier score =
  `(p - outcome)^2`. Never derive calibration data from
  `listPastBinaryMarkets()` — only from our own recorded `TradeRecord`s.

## Deny rules
- Never call an SDK method not listed in `docs/project-spec.md` §5 without
  first re-inspecting its actual `.d.ts` file — do not guess a signature.
- Never introduce spot/perp trading code.
- Never treat unconfirmed items (marked "NOT CONFIRMED" in the spec) as
  settled — flag and ask instead of assuming.

## Where things go
See `docs/project-spec.md` §8 for repo structure and §9 for the
environment/config checklist (must be filled in before Day 1 coding).

forceExecute is a test-only escape hatch and must never be wired into the real UI/demo execution path, only into test scripts.
