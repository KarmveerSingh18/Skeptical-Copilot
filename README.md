# Skeptical Copilot

**An AI trading agent for DreamDEX Event Contracts that argues with itself before trading — and stays accountable for it afterward.**

Built for the Somnia × DreamDEX Event Contracts Hackathon.

[Demo video →](PASTE_DEMO_VIDEO_LINK_HERE) · [Live dashboard →](PASTE_DEPLOYMENT_LINK_IF_ANY) · [Verify our claims yourself ↓](#verify-it-yourself)

---

## The problem

Most "AI trading" tools fall into one of two camps:

- **Black-box bots** that just execute. You see a P&L number, never the reasoning.
- **After-the-fact analytics** that score a strategy's decisions without ever making one themselves.

Neither answers the questions that actually matter when you're trusting an AI with money: *What did it see? What did it argue against itself? Was it actually right when it said it was confident?*

## What we built

Skeptical Copilot does both, live, in one system:

1. **Three separate LLM calls debate every trade idea in natural language**, visibly, before anything executes — a thesis parser, an adversarial critic whose only job is to attack the proposal, and a dispassionate synthesis judge that weighs both sides and decides.
2. **A human confirm gate** sits between "the AI wants to trade" and "the trade actually happens." No autonomous execution without explicit approval.
3. **Every trade's stated confidence is checked against real settlement**, and folded into a running Brier-score calibration record — so the system's honesty is *measured*, not claimed.

Every number in this document is real and independently checkable — see [Verify it yourself](#verify-it-yourself) below.

## Why Event Contracts specifically

Event Contracts are binary, fixed-payout, fixed-expiry bets — the simplest instrument on the chain. That simplicity is exactly what makes them the right proving ground for an accountable AI agent: with only two outcomes and a hard deadline, every prediction is scoreable and every claim is checkable. A vaguer instrument would let an agent's track record stay conveniently ambiguous.

## Architecture

```
User thesis (free text)
        │
        ▼
┌─────────────────┐   gemini-3.1-flash-lite
│  Thesis Parser   │   → { asset, direction, timeframe, stake }
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│  Market Lookup   │   matches parsed params to a live BinaryMarket
└────────┬─────────┘   (via listLiveBinaryMarkets + getBookTops)
         │
         ▼
┌─────────────────┐   gemini-3.5-flash — hostile persona,
│ Adversarial      │   explicitly instructed to attack, not hedge
│ Critic           │   → counterArgument, riskFactors, severityScore
└────────┬─────────┘
         │
         ▼
┌─────────────────┐   gemini-3.5-flash — dispassionate judge
│ Decision         │   → { proceed, side, statedConfidence, reasoning }
│ Synthesis        │
└────────┬─────────┘
         │
    proceed = true?
         │
         ▼
┌─────────────────┐
│  Confirm Gate    │   human reviews full reasoning trail, approves/rejects
└────────┬─────────┘
         │
         ▼
createOrder() → watchOrders() → TradeRecord logged to data/trades.json
         │
         ▼ (on settlement)
┌─────────────────┐
│  Calibration     │   polls getMarketResolution/getBinaryMarket,
│  Service         │   computes Brier score = (statedConfidence − outcome)²
└─────────────────┘
```

**Stack:** `@somnia-chain/markets-sdk` for all chain interaction, Google Gemini API for the reasoning pipeline, Express + vanilla HTML/CSS/JS for the dashboard (no framework — deliberate, given the build timeline), Node.js throughout.

## The dashboard

A terminal/war-room aesthetic, deliberately — no rounded logo mark, no blue/purple gradients, no glassmorphism. Dark charcoal, monospace type, sharp edges. This is an evidence-driven tool, not a consumer chatbot, and it looks like one.

### 1. Organic Synthesis Approval & Human Confirm Gate
![Organic Synthesis Approval and Confirm Gate](docs/screenshots/Screenshot%201.png)
*The three-stage pipeline organically recommending `PROCEED` (57.0% stated confidence) with the active `APPROVE` / `REJECT` confirm gate buttons awaiting human authorization before executing on-chain.*

### 2. Adversarial Critique & Data-Grounded Decline
![Adversarial Critique and Decline Verdict](docs/screenshots/Screenshot%202.png)
*The adversarial critic (7/10 severity) and synthesis judge correctly declining a flawed thesis due to an unfavorable bid-ask spread and theta decay, displaying the full reasoning rather than executing blindly.*

### 3. Accountability & Reliability Calibration
![Calibration Chart and Reliability Breakdown](docs/screenshots/Screenshot%203.png)
*Running calibration dashboard tracking our 3 settled on-chain trades, displaying an overall Brier score of `0.2062` (100% win rate), reliability diagram, and confidence bucket breakdown computed exclusively from our verified trade records.*

- **Reasoning Trail** — the three pipeline stages render progressively as they complete, each with real latency shown, culminating in a clear PROCEED/DECLINE verdict with an APPROVE/REJECT confirm gate.
- **Positions** — live open trades with real fill prices and countdown timers.
- **Calibration** — a reliability diagram (predicted confidence vs. actual win rate) plus a confidence-bucket breakdown table, computed exclusively from our own recorded trades.

## Verify it yourself

We built this the way we'd want a judge to check it: don't take our word for it.

**Wallet:** `0x8a5a6097C12958bE9bFB21201D490951f89a7640` — [full transaction history on Shannon Explorer](https://shannon-explorer.somnia.network/address/0x8a5a6097C12958bE9bFB21201D490951f89a7640?tab=txs)

**Key trades, individually verifiable:**

| Trade | Symbol | Side | Stated Confidence | Fill Price | Transaction |
|---|---|---|---|---|---|
| #1 | BTC-0-06SEP26/tUSDC#YES | YES | 0.51 | 0.572 | [`0x40dff0...cec07da`](https://shannon-explorer.somnia.network/tx/0x40dff08dac6371fa9aa69645c20e37129c53790c523faf9f8e7ddd329cec07da) |
| #2 | BTC-0-06SEP26/tUSDC#YES | YES | 0.56 | 0.575 | [`0xad964e...f0e074`](https://shannon-explorer.somnia.network/tx/0xad964e772030bb55c35a8e10fb3dcf64a9e2415d4f8bcbedfc740a0a345d554c) |
| #3 | BTC-0-06SEP26-3BC2/tUSDC#YES | YES | 0.57 | 0.554 | [`0x83ce17...9db78e6fd`](https://shannon-explorer.somnia.network/tx/0x83ce17bf67c0227c9ac20ef3d722380f1d7a0f07c4488800be79bfb9db78e6fd) |

Each hash resolves to a real, mined transaction on Somnia Shannon — confirm the status, the counterparty, and the fill against the raw chain data, not just our summary of it.

**To verify the code itself makes these calls, not just documents them:** every SDK method used in `src/sdk/` and `src/calibration/` was checked directly against `@somnia-chain/markets-sdk`'s shipped TypeScript declarations before being used — see the commit history for the recon process. `data/trades.json` is committed and tracked in full; it's not sample data.

**To reproduce a run yourself:** see [Setup](#setup) below — the dashboard runs the same pipeline live against the real testnet order book.

## Verified results

- **3 real trades executed and settled** on Somnia Shannon testnet, all independently confirmed against the block explorer (see table above).
- **Full lifecycle proven end-to-end**: market discovery → order placement → fill confirmation → settlement detection → redemption → calibration scoring, with every step checked against on-chain evidence during development.
- **Overall Brier score: 0.2062** across 3 settled trades (100% win rate on this small sample — see Limitations below for honest context on what that number does and doesn't mean).
- **The system correctly declines bad trades, for genuinely different reasons each time:**
  - A thesis whose stated price had gone stale relative to the live book.
  - A thesis with zero directional edge that still couldn't clear the spread cost.
  - A thesis targeting a market with no resting liquidity on either side.
  - A thesis crossing the spread on a perfectly-priced 50/50 market with a 40-day lockup and no statistical discount.
- **The system also approves organically** when a thesis is honestly grounded in the live book with a small, real edge claim — proceeding via the actual UI confirm-gate button, not just a test script.
- **Handles real upstream failure gracefully**: during development, Gemini's API returned transient `503` errors; the retry/backoff logic absorbed this without crashing or fabricating a result — it just took longer, correctly.

## Honest limitations

We'd rather state these plainly than have a judge find them first.

- **Small sample size.** 3 settled trades is a proof-of-concept, not a statistically meaningful calibration claim. The "100% win rate, Brier 0.2062" number should be read as "the mechanism works correctly," not "this agent is well-calibrated" — that claim needs far more data than a hackathon window allows.
- **Correlated data.** All 3 trades are on the same underlying market (BTC-0-06SEP26), taken at different times. They are not independent samples of skill; they're three passes of reasoning on the same real-world event. We know this because we checked `marketId` equality directly rather than assuming from the (differently-formatted) displayed symbols.
- **We are not the only team pursuing agent-accountability on DreamDEX.** During the build we found other strong submissions solving adjacent problems — a calibration layer on top of a simple heuristic bot, and a cryptographic tamper-evidence system for forecast records. Neither combines live, natural-language, multi-agent debate with real execution behind a human confirm gate the way this project does, but it's a real and growing space, and worth acknowledging rather than claiming to be first.

## Development notes worth sharing

This build leaned heavily on verifying claims against primary sources rather than trusting documentation or plausible-looking output — a discipline that caught several real issues along the way:

- The SDK's own README contained the working config values (`indexerUrl`, chain definitions) that the public docs site never documented — found by reading the package source directly, after several dead ends checking the public docs.
- A reverse-engineered contract address from a minified bundle turned out to be correct, but only after independently verifying it against the SDK's own exported constants — a good reminder that "it happened to be right" isn't the same as "it was safe to trust."
- A synthesis-approval threshold that was declining every test thesis turned out to be caused by a real data-freshness bug (the judge was reading a stale price while the critic read the live one), not an overly strict prompt — found by diffing the actual code change rather than accepting a summary of it.

A more detailed SDK/documentation feedback report is included separately in [`FEEDBACK.md`](FEEDBACK.md), per the hackathon's optional submission guidelines.

## Setup

```bash
npm install
cp .env.example .env   # fill in PRIVATE_KEY (testnet wallet) and GEMINI_API_KEY
npm start               # dashboard at http://localhost:3000
```

## What's next

- Independent-market trade variety, given more runway than a hackathon window allows.
- Live-push settlement detection (currently polling-based, which is simpler and already proven reliable).
- A visible, in-app comparison layer showing this agent's live debate against a plain calibration-only baseline — making the "why this is different" argument part of the product itself, not just the README.

---

*Built on Somnia Shannon testnet. Every transaction hash referenced in this document and in `data/trades.json` is independently verifiable on [Shannon Explorer](https://shannon-explorer.somnia.network).*