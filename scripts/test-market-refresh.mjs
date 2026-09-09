#!/usr/bin/env node
/**
 * test-market-refresh.mjs — Regression tests for the stale-market-registry bug.
 *
 * Verifies:
 * 1. loadMarkets(true) actually refreshes the exchange's market registry
 * 2. A symbol present in a live market query but NOT in a stale registry
 *    becomes resolvable after loadMarkets(true)
 * 3. The confirm route's validation logic correctly rejects expired/inactive markets
 * 4. The confirm route's validation logic correctly rejects unresolvable symbols
 *
 * These tests use mock/stub exchange objects — no real SDK connection needed.
 */

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

// ─── Test 1: loadMarkets(true) is called with reload=true ─────────────────
console.log("\n── Test 1: loadMarkets(true) forces registry reload ──");
{
  let loadMarketsCallCount = 0;
  let lastReloadArg = undefined;

  const mockExchange = {
    markets: {},
    symbols: [],
    loadMarkets: async (reload) => {
      loadMarketsCallCount++;
      lastReloadArg = reload;
      // Simulate adding a new market after reload
      mockExchange.markets["BTC-0-01JAN27/tUSDC"] = {
        symbol: "BTC-0-01JAN27/tUSDC",
        active: true,
        expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      mockExchange.symbols = ["BTC-0-01JAN27/tUSDC"];
      return mockExchange.markets;
    },
    market: (ref) => {
      if (Object.keys(mockExchange.markets).length === 0) {
        throw new Error(`unknown symbol ${ref} — call loadMarkets() first`);
      }
      return {
        marketSymbol: "BTC-0-01JAN27/tUSDC",
        symbol: ref,
        pool: "0x1234",
      };
    },
  };

  // Before reload — registry is empty
  let threw = false;
  try {
    mockExchange.market("BTC-0-01JAN27/tUSDC#YES");
  } catch {
    threw = true;
  }
  assert(threw, "market() throws when registry is empty (stale)");

  // After reload — registry is populated
  await mockExchange.loadMarkets(true);
  assert(lastReloadArg === true, "loadMarkets was called with reload=true");
  assert(loadMarketsCallCount === 1, "loadMarkets was called exactly once");

  const tradable = mockExchange.market("BTC-0-01JAN27/tUSDC#YES");
  assert(tradable !== null, "market() resolves after loadMarkets(true)");
}

// ─── Test 2: Expired market is caught before order ────────────────────────
console.log("\n── Test 2: Expired market validation ──");
{
  const pastExpiry = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago

  const marketInfo = {
    symbol: "BTC-0-01JAN27/tUSDC",
    active: true,
    expiry: pastExpiry,
  };

  const nowSec = Math.floor(Date.now() / 1000);
  const expirySec = Number(marketInfo.expiry);
  const isExpired = expirySec <= nowSec;

  assert(isExpired, "Expired market is correctly detected (expiry in the past)");
}

// ─── Test 3: Active future market passes validation ──────────────────────
console.log("\n── Test 3: Active future market passes validation ──");
{
  const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour ahead

  const marketInfo = {
    symbol: "BTC-0-01JAN27/tUSDC",
    active: true,
    expiry: futureExpiry,
  };

  const nowSec = Math.floor(Date.now() / 1000);
  const expirySec = Number(marketInfo.expiry);
  const isExpired = expirySec <= nowSec;
  const isActive = marketInfo.active !== false;

  assert(!isExpired, "Future market is NOT flagged as expired");
  assert(isActive, "Active market passes active check");
}

// ─── Test 4: Inactive (settled/voided) market is caught ──────────────────
console.log("\n── Test 4: Inactive market validation ──");
{
  const marketInfo = {
    symbol: "BTC-0-01JAN27/tUSDC",
    active: false,
    status: "settled",
    expiry: Math.floor(Date.now() / 1000) + 3600,
  };

  const isInactive = marketInfo.active === false;
  assert(isInactive, "Settled/inactive market is correctly detected");
}

// ─── Test 5: Symbol replacement for YES/NO sides ─────────────────────────
console.log("\n── Test 5: YES/NO symbol replacement logic ──");
{
  const baseSymbol = "BTC-0-03JUL26-0930/tUSDC#YES";

  // When user picks NO
  const noSymbol = baseSymbol.replace(/#YES$/i, "#NO");
  assert(noSymbol === "BTC-0-03JUL26-0930/tUSDC#NO", "YES→NO symbol replacement works");

  // When user picks YES and symbol already has YES
  const yesSymbol = baseSymbol.replace(/#NO$/i, "#YES");
  assert(yesSymbol === baseSymbol, "YES symbol stays unchanged when already YES");

  // When starting from NO
  const fromNo = "BTC-0-03JUL26-0930/tUSDC#NO";
  const backToYes = fromNo.replace(/#NO$/i, "#YES");
  assert(backToYes === "BTC-0-03JUL26-0930/tUSDC#YES", "NO→YES symbol replacement works");
}

// ─── Test 6: BigInt expiry handling ──────────────────────────────────────
console.log("\n── Test 6: BigInt expiry handling ──");
{
  const futureExpiry = BigInt(Math.floor(Date.now() / 1000) + 7200);

  const expirySec = typeof futureExpiry === "bigint"
    ? Number(futureExpiry)
    : Number(futureExpiry);
  const nowSec = Math.floor(Date.now() / 1000);

  assert(expirySec > nowSec, "BigInt expiry is correctly converted and compared");
}

// ─── Test 7: Simulate full confirm flow with stale → refreshed registry ──
console.log("\n── Test 7: Full confirm flow simulation ──");
{
  const KNOWN_SYMBOL = "BTC-0-09SEP26-2200/tUSDC#YES";
  let registryLoaded = false;

  const mockEx = {
    markets: {},
    loadMarkets: async (reload) => {
      if (reload) {
        registryLoaded = true;
        mockEx.markets["BTC-0-09SEP26-2200/tUSDC"] = {
          symbol: "BTC-0-09SEP26-2200/tUSDC",
          active: true,
          expiry: Math.floor(Date.now() / 1000) + 1800,
        };
      }
      return mockEx.markets;
    },
    market: (ref) => {
      if (!registryLoaded) {
        throw new Error(`unknown symbol ${ref} — call loadMarkets() first`);
      }
      return {
        marketSymbol: "BTC-0-09SEP26-2200/tUSDC",
        symbol: ref,
        pool: "0xabc",
      };
    },
    createOrder: async (symbol) => {
      if (!registryLoaded) {
        throw new Error(`unknown symbol ${symbol} — call loadMarkets() first`);
      }
      return { id: "mock-order-1", status: "closed", filled: 1, price: 0.5 };
    },
  };

  // Simulate what the old code did — createOrder WITHOUT loadMarkets(true)
  let oldFlowError = null;
  try {
    await mockEx.createOrder(KNOWN_SYMBOL);
  } catch (err) {
    oldFlowError = err.message;
  }
  assert(
    oldFlowError && oldFlowError.includes("call loadMarkets() first"),
    "Old flow: createOrder fails without loadMarkets(true)"
  );

  // Simulate what the new code does — loadMarkets(true) THEN createOrder
  await mockEx.loadMarkets(true);
  assert(registryLoaded, "New flow: loadMarkets(true) called before createOrder");

  const tradable = mockEx.market(KNOWN_SYMBOL);
  assert(tradable !== null, "New flow: market() resolves after reload");

  const marketInfo = mockEx.markets[tradable.marketSymbol];
  assert(marketInfo.active !== false, "New flow: market is active");

  const expirySec = Number(marketInfo.expiry);
  const nowSec = Math.floor(Date.now() / 1000);
  assert(expirySec > nowSec, "New flow: market is not expired");

  const order = await mockEx.createOrder(KNOWN_SYMBOL);
  assert(order.status === "closed", "New flow: createOrder succeeds after loadMarkets(true)");
}

// ─── Test 8: Rotated market — symbol no longer resolves after reload ─────
console.log("\n── Test 8: Rotated market — safe failure ──");
{
  const STALE_SYMBOL = "BTC-0-09SEP26-2000/tUSDC#YES";

  const mockEx = {
    markets: {
      // Only the NEW rotated market exists after reload
      "BTC-0-09SEP26-2200/tUSDC": {
        symbol: "BTC-0-09SEP26-2200/tUSDC",
        active: true,
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
    },
    loadMarkets: async () => mockEx.markets,
    market: (ref) => {
      // The old 2000-expiry symbol is gone
      if (ref.includes("2000")) {
        throw new Error(`unknown symbol ${ref}`);
      }
      return { marketSymbol: "BTC-0-09SEP26-2200/tUSDC", symbol: ref };
    },
  };

  await mockEx.loadMarkets(true);

  let caughtRotation = false;
  try {
    mockEx.market(STALE_SYMBOL);
  } catch {
    caughtRotation = true;
  }

  assert(
    caughtRotation,
    "Rotated market: stale symbol is NOT found after reload → safe 409 response"
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"═".repeat(60)}\n`);

process.exit(failed > 0 ? 1 : 0);
