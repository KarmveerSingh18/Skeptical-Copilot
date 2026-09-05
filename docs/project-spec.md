# Skeptical Copilot + Calibration Tracker
### DreamDEX Event Contracts Hackathon — Project Spec & SDK Grounding Doc

> **Purpose of this file:** This is the grounding context for an agentic coding
> tool (Antigravity). Every SDK method/type referenced below was read directly
> from the installed `@somnia-chain/markets-sdk` TypeScript declaration files —
> not inferred or guessed. **Do not invent or assume any SDK method, field, or
> signature not listed here.** If a needed capability isn't confirmed below,
> stop and flag it rather than fabricating a plausible-looking call — this SDK
> has hundreds of methods and several near-duplicate reads (chain vs. live
> vs. indexer tiers), and a wrong guess will compile-fail or silently misbehave.

---

## 1. One-line pitch

An AI trading agent for DreamDEX Event Contracts that argues with itself before
every trade — proposing a position from your stated thesis, red-teaming it,
then executing only if it still believes the position — and publishes a
running, real-settlement-backed calibration score so its trustworthiness is
measurable, not claimed.

## 2. Problem / solution

People don't trust autonomous trading agents with money because agents present
single confident conclusions with no visible reasoning and no track record.
This project solves both halves of that trust problem at once:

- **Per-trade trust**: the agent visibly argues against its own thesis before
  acting (adversarial self-critique), not just a post-hoc explanation.
- **Over-time trust**: every trade's stated confidence is checked against real
  settlement outcomes, producing a calibration curve (was "70% confident"
  actually right ~70% of the time?) — accountability via data, not vibes.

## 3. Why this genuinely requires DreamDEX Event Contracts

This is not "AI + blockchain for its own sake" — the concept is structurally
impossible without Event Contracts specifically:

- The debate step needs a **binary, falsifiable proposition with a fixed
  expiry** — that's what a `BinaryMarket` *is* (strike + window + YES/NO).
  A spot/perp trade has no such fixed resolution point to argue about.
- The calibration tracker needs **real, timestamped settlement ground truth**
  — `winningOutcome` / `payoutNumerators` after `expiry`. Spot markets never
  "settle" in this sense.
- Event Contracts' short windows (15m/1h per `intervalSec`) mean multiple real
  settled trades can be produced within a single demo recording — this is the
  product feature that makes the demo possible at all.

## 4. Competitive differentiation (from the 7 known submissions)

- **QDS** — broad "AI predicts/analyzes/trades for you" platform. We go narrow
  and sharp instead: the *visible debate* and *calibration score* are the
  product, not a feature bolted onto a general platform.
- **Rivo Intelligence** — verifies whether *other* autonomous agents/markets
  are trustworthy. We are not a verification layer for others; we hold
  *ourselves* accountable via calibration.
- **Vitamin M** — market safety verification (is this market safe to trade).
  Different axis — that's about the market, ours is about the agent's own
  epistemic honesty and track record.
- No current submission does adversarial self-critique or a settlement-backed
  calibration score. This is the wedge.

---

## 5. CONFIRMED SDK API Surface

All methods below were read directly from `dist/*.d.ts` files in the installed
package. Source file noted per group. **Anything not in this list should be
treated as unverified** — re-inspect the relevant `.d.ts` before using it.

### 5.1 Setup (`unified/exchange.d.ts`)
```ts
import { SomniaMarkets } from "@somnia-chain/markets-sdk";

const exchange = new SomniaMarkets({
  chain,        // a viem Chain
  wsRpcUrl,     // wss:// RPC of that chain
  indexerUrl,   // the Envio/Hasura GraphQL endpoint
  addresses,    // contract addresses (e.g. from @somnia-chain/deployments)
  privateKey,   // optional — only createOrder & friends need a signer
});
await exchange.loadMarkets();
```
Tradable symbol format (from the SDK's own JSDoc example):
`"BTC-95000-31DEC26/USDC#YES"` — `{ASSET}-{STRIKE}-{EXPIRY}/{COLLATERAL}#{YES|NO}`

### 5.2 Discover a BinaryMarket (`markets.d.ts`, `somniaMarketsClient.d.ts`)
```ts
client.listLiveBinaryMarkets(filter?: LiveBinaryMarketsFilter): Promise<BinaryMarket[]>
// filter: { operatorId?, venueId?, asset?, intervalSec?, status?, search?, creator?, orderBy?, limit?, offset?, nowSec? }
// expiry > now, soonest-to-expire first

client.getBinaryMarket(id: string): Promise<BinaryMarket | null>
client.listPastBinaryMarkets(opts?: PastBinaryMarketsOptions): Promise<BinaryMarket[]>
// expiry <= now, most-recently-expired first — useful for market-history/context UI
// and testing; do NOT treat these as historical AI predictions unless we have
// our own TradeRecords for those markets.
```
All read-only, no signer required.

### 5.3 Probability / order book (`markets.d.ts`, `somniaMarketsClient.d.ts`)
```ts
market.lastPrice: string | null   // ≈ YES probability × 10^decimals; null until first fill
client.getBookTops(marketIds: string[]): Promise<Record<string, BookTop>>
client.getLiveBinaryOrderBook(pool: string, opts?: { depth?: number }): BinaryOrderBook
// ^ requires an active watchMarket(pool) — synchronous, zero-round-trip once watching
client.quoteBinaryOrder(params: { pool?, marketId?, side: BinarySide, quantity: bigint, depth? }): BinaryOrderQuote
client.quoteBinaryStake(params: { side: BinaryBuySide, stake: bigint, ... }): Promise<BinaryStakeQuote | null>
// ^ "bet $50 on Up" sizing — sizes shares from a collateral budget
```
> **NOT CONFIRMED**: `midYesPrice`, `outcomeMarkPrice` (named in the package
> barrel export list only — their exact signatures were never inspected in
> `derivedReads.d.ts`). Do not call these without re-checking that file first.

### 5.4 Expiry / window fields (`markets.d.ts` — `BinaryMarket` type)
```ts
market.expiry: string          // unix seconds — trading close / settlement time
market.tradingStart: string    // unix seconds
market.intervalSec?: string    // "900"|"3600"|"14400"|"86400" (15m/1h/4h/24h)
market.interval?: string       // human label, e.g. "15m" — SDK-derived, ready to render
market.status: BinaryMarketStatus  // lifecycle; derive LIVE trading state from
                                    // tradingStart/expiry per the field's own
                                    // doc-comment, don't trust status alone
```

### 5.5 Place a trade (`unified/exchange.d.ts`)
```ts
exchange.createOrder(
  ref: string,                       // tradable symbol
  type: "limit" | "market",
  side: "buy" | "sell",
  amount: number,                    // human units
  price?: number,                    // required for "limit"
  params?: CreateOrderParams         // { timeInForce?, slippage?, builder?, builderFeeBpsTimes1k? }
): Promise<UnifiedOrder>
```
Throws `SignerRequiredError` without a signer configured. Real signature —
confirmed directly, including the worked example in the SDK's own JSDoc.

### 5.6 Monitor fill (`unified/exchange.d.ts`)
```ts
// This exact loop is the SDK's own documented pattern:
while (placed.status === "open") {
  const orders = await exchange.watchOrders(symbol);   // resolves on next change
  const mine = orders.find(o => o.id === placed.id);
  if (!mine || mine.status !== "open") break;
}
```
Alternatives: `client.getLiveUserOrders(pool, user)`, `client.getLiveFills(pool)`.

### 5.7 Detect settlement (`somniaMarketsClient.d.ts`)
```ts
client.getMarketStatusHistory(marketId: string): Promise<MarketStatusUpdate[]>
// oldest-first: Trading → Locked → Settling → Resolved (or Voided)

client.getMarketResolution(marketId: string): Promise<{
  events: MarketResolutionEvent[];
  reference: MarketReferenceLink | null;
  closingAnswer: OracleAnswer | null;   // the market's own resolution answer
  openingAnswer: OracleAnswer | null;   // reference price it resolves against
  oracleAnswer: OracleAnswer | null;    // deprecated alias of closingAnswer
}>
```
> **NOT CONFIRMED**: whether `watchMarket()`'s live stream surfaces a
> "Resolved" transition as something directly awaitable, vs. requiring you to
> poll `getMarketStatusHistory`. Build the MVP assuming **polling** (simpler,
> proven); treat live-push settlement detection as a stretch goal only if
> `store.d.ts` confirms a mechanism.

### 5.8 Retrieve outcome (`markets.d.ts` — `BinaryMarket` type)
```ts
market.winningOutcome: number | null      // 0 = YES, 1 = NO
market.payoutNumerators?: string[] | null // per-outcome payout vector (handles void)
market.voided: boolean
```
Chain-read alternative: `client.getMarketOnchain(marketId)` → `.isResolved` /
`.isVoided` / `.winningOutcome`.

### 5.9 Redeem (`unified/exchange.d.ts`, `somniaMarketsClient.d.ts`)
```ts
const bal = await exchange.fetchBalance();
const winning = bal["BTC-95000-31DEC26/USDC#YES"]?.total ?? 0;
if (winning > 0) await exchange.redeem(ref: string, amount: number): Promise<{ hash, info }>;

// Portfolio-wide sweep:
client.getClaimable(account: string): Promise<ClaimablePosition[]>
// ^ pre-shaped for trader.redeemMany({ entries }) — use for "redeem everything" button
```

## 5.10 AI market-information policy

The MVP must explicitly define what information the AI is allowed to use when forming
its thesis. At minimum, Event Contract market data such as `lastPrice`, book tops,
expiry, and other confirmed SDK data may be used.

If external underlying-asset market/news data is added, use only a deliberately
selected, reliable source and document it as an external dependency. Do not imply
that the Event Contract order book itself constitutes independent evidence about the
underlying asset.

For the first end-to-end implementation, keep the external-data surface minimal and
avoid building a large market-data pipeline unless it is required for the chosen
demo thesis.

---

---

## 6. System architecture

```
┌─────────────────────────────────────────────────────────────┐
│  UI (chat + reasoning trail + position list + calibration)  │
└───────────────┬───────────────────────────┬─────────────────┘
                │                           │
        ┌───────▼────────┐         ┌────────▼─────────┐
        │  Thesis Parser  │         │  Calibration      │
        │  (LLM call #1)  │         │  Service          │
        └───────┬────────┘         │  (poll status,     │
                │                  │   compute Brier     │
        ┌───────▼────────┐         │   score / curve)    │
        │ Adversarial     │         └────────┬─────────┘
        │ Critic          │                  │
        │ (LLM call #2)   │                  │
        └───────┬────────┘                  │
                │                           │
        ┌───────▼────────┐                  │
        │ Decision        │                  │
        │ Synthesis       │                  │
        │ (LLM call #3)   │                  │
        └───────┬────────┘                  │
                │                           │
        ┌───────▼───────────────────────────▼─────────┐
        │      SomniaMarkets SDK Client (single       │
        │      instance, shared across services)      │
        └───────────────────────┬──────────────────────┘
                                │
                    DreamDEX (Somnia testnet)
```

### 6.1 Component responsibilities

1. **Thesis Parser** — free text → `{ asset, direction, strike/window preference, stake }`.
   Uses `listLiveBinaryMarkets({ asset, intervalSec })` to find the matching
   contract once the asset/window is extracted.
2. **Adversarial Critic** — separate LLM call, adversarial system prompt,
   argues against the proposed trade using current book state
   (`getBookTops`, `lastPrice`) as grounding context.
3. **Decision Synthesis** — weighs proposal vs. critique, outputs go/no-go +
   stated confidence (a number, logged for calibration).
4. **Execution** — `createOrder(...)`, confirm-before-trade gate in the UI.
5. **Calibration Service** — background poller (interval ≈ half the shortest
   traded window, e.g. every 5min for 15m markets) calling
   `getMarketStatusHistory` on open positions; on `Resolved`, reads
   `winningOutcome`, compares against the logged stated confidence, updates
   a running Brier score.
6. **Redemption** — manual per-position `redeem()` for the MVP. A
   portfolio-wide batch redemption is stretch only after the relevant SDK
   declaration for the batch method has been inspected and confirmed.

### 6.2 Data to log per trade (for the calibration chart)

> **Calibration convention:** `statedConfidence` is always the probability of the
> **predicted side**, not necessarily YES. For Brier scoring, normalize the
> record to `p = probability assigned to the predicted side`; the outcome is
> `1` if the predicted side wins and `0` otherwise. Brier score is `(p - outcome)^2`.

```ts
interface TradeRecord {
  marketId: string;
  thesis: string;           // user's original text
  proposedSide: "YES"|"NO";
  criticSummary: string;    // the adversarial argument, for the reasoning trail
  statedConfidence: number; // 0-1, from Decision Synthesis
  stake: number;
  txHash: string;
  placedAt: number;
  expiry: number;           // from market.expiry — poll target
  outcome?: 0 | 1 | "voided"; // filled in once resolved
  resolvedAt?: number;
}
```

---

## 7. MVP scope (must-have vs. stretch)

**Must-have (judged demo depends on these):**
- Thesis → parsed market match → propose/critique/decide loop, visible in UI
- Real `createOrder` execution on testnet with confirm-before-trade
- A complete end-to-end trade/settlement loop first; target 3-5 real settled trades with a rendered calibration chart before recording the demo
- Basic error handling: bad parse, market not found, insufficient balance

**Stretch (only after must-haves are solid):**
- Live-push settlement detection (pending `store.d.ts` confirmation)
- Portfolio-wide batch redemption UI only after the relevant SDK declaration is inspected and confirmed
- Multi-asset / multi-window support beyond one asset

**Explicitly out of scope for the hackathon window:**
- Any spot/perp functionality — stay Event-Contract-only, on-theme
- Market-making or liquidity provision
- Mainnet deployment

---

## 8. Suggested repo structure

```
/src
  /agent
    thesisParser.ts       # LLM call #1
    critic.ts             # LLM call #2 (adversarial)
    synthesis.ts           # LLM call #3 (decision)
  /sdk
    client.ts              # single shared SomniaMarkets instance
    marketLookup.ts         # thesis params -> matching BinaryMarket
  /calibration
    poller.ts              # background settlement polling
    brier.ts                # scoring math
  /ui
    ChatPanel.tsx
    ReasoningTrail.tsx
    PositionList.tsx
    CalibrationChart.tsx
/docs
  project-spec.md          # this file
```

---

## 9. Environment / config checklist

The following testnet configuration is now confirmed from the `@somnia-chain/markets-sdk` README and its exported chain/address definitions.

- [x] `chain` — `somniaShannon`, imported from `@somnia-chain/markets-sdk/chains`
- [x] `indexerUrl` — `https://dev.smk.somnia.host/v1/graphql`
- [x] `wsRpcUrl` — `wss://api.infra.testnet.somnia.network/ws`
- [x] `addresses` — `SOMNIA_TESTNET_ADDRESSES`, imported from `@somnia-chain/markets-sdk`
- [ ] `privateKey` — funded Shannon testnet wallet, supplied through `process.env.PRIVATE_KEY`
- [x] LLM API key (Gemini / GEMINI_API_KEY) for the three-call reasoning pipeline

### Confirmed SDK setup

```ts
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const exchange = new SomniaMarkets({
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
  privateKey: process.env.PRIVATE_KEY,
});

await exchange.loadMarkets();
```

> **Important:** Do not substitute the DreamDEX spot REST root
> (`https://stg.api.dreamdex.io/v0`) for `indexerUrl`, and do not substitute
> its public REST WebSocket for `wsRpcUrl`. The values above are the SDK's
> confirmed Shannon testnet configuration.

### Still to verify during implementation

- [ ] Whether a separate `VENUE_ID` is required by the chosen SDK calls in the
      actual Event Contract flow. Do not hardcode one unless the relevant
      declaration/example requires it.
- [ ] If using an operator/session-key architecture, inspect the exact SDK
      declaration for `placeOrderFor` before using it. It is not part of the
      confirmed Section 5 surface and must not be assumed.
- [ ] Keep real-money/mainnet credentials out of the project. MVP is testnet-only.
- [ ] Keep `DRY_RUN=true` (or an equivalent application-level trade guard) until
      the manual testnet trade has been independently verified.

---

## 10. 11-day build plan (adjust dates against actual remaining runway)

| Day | Focus |
|---|---|
| 1-2 | Env setup; `loadMarkets()` + one manual `createOrder` end-to-end on testnet; **do not proceed until one complete trade loop is verified** |
| 3-4 | Thesis Parser (LLM #1) → market lookup via `listLiveBinaryMarkets` |
| 5-6 | Critic (LLM #2) + Synthesis (LLM #3); wire into `createOrder` with confirm gate |
| 7 | Calibration Service: poller + Brier score math + first real settled trades |
| 8 | UI pass: reasoning trail, calibration chart, position list |
| 9 | Buffer day |
| 10 | Record demo (need several already-settled trades showing on the chart) |
| 11 | Submit early |

---

## 11. Judging criteria alignment (for the demo script / README)

- **Innovation (20%)**: adversarial self-critique + settlement-backed
  calibration — neither exists in the current submission field.
- **Technical Implementation (25%)**: real `createOrder`/`redeem` on testnet,
  three-stage LLM reasoning pipeline, polling-based settlement detection.
- **UX (20%)**: the reasoning trail *is* the UX — make the debate readable,
  not just logged.
- **Business/Ecosystem Impact (20%)**: trust is the actual adoption blocker
  for prediction markets — this directly targets it with evidence, not claims.
- **Presentation (15%)**: script the demo around one thesis → one debate →
  one trade → (if timing allows) one real settlement + calibration update.

---

## 12. Rules for the coding agent (Antigravity)
1. Every SDK call must match Section 5 exactly. If a needed capability isn't
   there, stop and ask rather than inventing a method name.
2. The first implementation milestone is one complete end-to-end testnet loop:
   market discovery → analysis → user confirmation → order → fill →
   settlement → recorded outcome. Do not build broader features before this
   works.
3. Keep the three LLM calls (parse / critique / synthesize) as separate,
   independently-promptable functions — this is core to the product's
   credibility story, not an implementation detail to collapse for convenience.
4. Log every `TradeRecord` field from Section 6.2 — the calibration chart is
   worthless without complete data from trade #1 onward.
5. Treat `statedConfidence` as the probability of the predicted side and use
   the documented Brier convention in Section 6.2.
6. Do not use `listPastBinaryMarkets()` as evidence of historical AI
   calibration. Calibration data must come from our own prediction/trade
   records created before settlement.
7. Do not build spot/perp features under any circumstance — off-theme for
   this hackathon.
8. Keep AI market grounding explicit. If external market/news data is
   introduced, treat it as a separately verified dependency rather than
   assuming the Event Contract book is sufficient independent evidence.
9. Prefer the documented JSDoc examples in Section 5 verbatim where they
   exist (setup, `createOrder`, `watchOrders` loop, `redeem`) — they are the
   SDK author's own confirmed usage pattern.
10. Use the exact testnet configuration in Section 9. Do not replace the
    confirmed SDK `indexerUrl` or `wsRpcUrl` with DreamDEX's spot REST/WebSocket
    endpoints.
