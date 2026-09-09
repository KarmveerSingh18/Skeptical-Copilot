# SDK & Documentation Feedback

Submitted as the optional feedback report per the hackathon's submission guidelines. Everything below is a real, specific issue we hit while building — not a generic wishlist. Where useful, we've noted roughly how much time it cost us, since that's the thing worth optimizing for future builders.

---

## 1. The TypeScript SDK isn't discoverable from the public docs at all

This was the single biggest time cost in the whole build.

`docs.dreamdex.io`'s **Quick Start**, **Event Contracts**, **HTTP API**, and **Libraries** pages are all REST/CLI-first — `curl`, `$BASE_URL`, the `dreamDEX CLI`. The **Libraries** page lists exactly one integration: CCXT.

`@somnia-chain/markets-sdk` — a full, well-built, typed TypeScript SDK with realtime watches, a unified exchange interface, and React hooks — is never mentioned or linked anywhere on the public docs site. We only found it because we already knew the package name going in. A developer arriving at docs.dreamdex.io cold would have no way to discover it exists.

**Suggested fix:** add a "TypeScript SDK" entry to the Libraries page, or a callout on the Quick Start page pointing to it as the recommended path for anything beyond simple scripted REST calls.

## 2. `indexerUrl` — a required config field with no publicly documented value

`ClientConfig.indexerUrl` is marked required in the SDK's own type definitions, but its real value (`https://dev.smk.somnia.host/v1/graphql` for testnet) doesn't appear on `docs.dreamdex.io` anywhere we could find — not Quick Start, not the Event Contracts page (which shows a code sample using `indexerUrl` as a bare variable name, never assigned), not HTTP API, not Libraries.

We eventually found it in the **SDK package's own `README.md`**, shipped in `node_modules`, not linked from the docs site. This cost real, avoidable time — we went through Bot Kit's config, its `.env.example`, and several docs pages before finding the actual source of truth.

**Suggested fix:** the SDK README's setup snippet is already correct and complete — just link to it (or mirror it) from the public docs site's Quick Start / Libraries page.

## 3. Bot Kit and `markets-sdk` look related but aren't — and nothing says so

`dreamdex-bot-kit` and `@somnia-chain/markets-sdk` are two separate, independently-built tools. Bot Kit constructs its own raw viem `PublicClient`/`WalletClient` directly (`packages/core/src/client.ts`) and never imports the SDK. Its own network config (`packages/core/src/config/networks.ts`) uses a different testnet RPC (`https://dream-rpc.somnia.network`) than the one `markets-sdk`'s own chain definitions bake in (`wss://api.infra.testnet.somnia.network/ws`).

We spent a meaningful chunk of time assuming Bot Kit's config would transfer to `markets-sdk` usage, since both are official DreamDEX/Somnia repos with overlapping purpose (building trading bots). It doesn't, cleanly — the two projects don't share a client, a config shape, or (as far as we found) any explicit cross-reference to each other.

**Suggested fix:** a short note in either repo's README clarifying the relationship (or lack of one) between the two would have saved real time — e.g., "Bot Kit is a standalone strategy runner; if you want the typed SDK directly, see `@somnia-chain/markets-sdk`."

## 4. `VENUE_ID` stability warning is buried in a comment, not the docs

Bot Kit's `.env.example` contains a genuinely useful warning most builders would never see: the testnet `VENUE_ID` "moved three times in the first week of August" and should be discovered live via `listBinaryVenueIds()` rather than hardcoded. This is exactly the kind of testnet-instability warning that belongs in the public docs (Event Contracts or Quick Start page), not buried in an `.env.example` comment in a separate repo.

**Suggested fix:** surface this as a visible callout wherever venue/operator IDs are first introduced in the docs.

## 5. The "right" redemption pattern isn't signposted

`markets-sdk` offers both `exchange.redeem()` (single-market) and `client.getClaimable()` + `trader.redeemMany()` (portfolio-wide, doesn't require the market to be in the live registry). The latter is clearly the more robust production pattern — but nothing in the docs or the SDK's own JSDoc explicitly recommends it over the simpler single-market call. We only found it by reading `trade.js` source directly after hitting a real limitation with the simpler approach (a finalized market dropping out of the live registry).

**Suggested fix:** a one-line note on `redeem()`'s JSDoc pointing to `getClaimable()` + `redeemMany()` as the preferred pattern for anything beyond a single known market.

---

## What worked well, worth saying explicitly

- Once we found the SDK package's own `README.md` and its linked `docs/*.md` guides, they were genuinely excellent — accurate, example-rich, and (as far as we tested) correct. The problem was discoverability, not quality.
- The TypeScript declaration files are thorough and precise enough that we were able to verify SDK behavior directly against source whenever documentation was thin — a strong fallback, even if it shouldn't have been necessary as often as it was.
- `SOMNIA_TESTNET_ADDRESSES`, `SOMNIA_TESTNET_PRICE_FEED`, and the pre-built chain definitions in `@somnia-chain/markets-sdk/chains` are a genuinely good design — real, ready-to-use constants instead of asking every builder to source addresses independently.

Thank you for building the event contracts primitive — Event Contracts' simplicity (binary, fixed payout, hard expiry) made them a great foundation to build an accountable AI agent on top of, which was the whole premise of our submission.
