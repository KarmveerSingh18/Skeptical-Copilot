try {
  process.loadEnvFile(".env");
} catch {
  // .env may not exist or already provided in environment
}

import express from "express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runPipeline } from "./sdk/pipeline.js";
import { readTradeLog } from "./calibration/tradeLog.js";
import {
  computeCalibrationSummary,
  pollSettledTrades,
} from "./calibration/calibrationService.js";
import { getExchange } from "./sdk/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, "ui")));

// getExchange() from client.js is already a singleton factory — no wrapper needed.

// ─── In-memory pipeline state (keyed by UUID, expires after 5 min) ───────────
const pendingPipelines = new Map();
const PIPELINE_TTL_MS = 5 * 60 * 1000;

function storePipelineState(state) {
  const id = randomUUID();
  pendingPipelines.set(id, state);
  setTimeout(() => pendingPipelines.delete(id), PIPELINE_TTL_MS);
  return id;
}

// ─── API Routes ──────────────────────────────────────────────────────────────

/**
 * POST /api/pipeline
 * Runs LLM stages 1-3 (parse → critique → synthesize).
 * Returns the reasoning trail + pipelineId. Does NOT execute a trade.
 * The client must call /api/pipeline/confirm to approve execution.
 */
app.post("/api/pipeline", async (req, res) => {
  try {
    const { thesis } = req.body;
    if (!thesis || typeof thesis !== "string" || thesis.trim().length === 0) {
      return res.status(400).json({ error: "Missing or empty 'thesis' field" });
    }

    const ex = await getExchange();

    // Run pipeline WITHOUT a confirmGate — we handle confirmation via the
    // two-phase API. We override the pipeline to stop before execution by
    // passing a confirmGate that always returns false, then capturing the
    // trail data.
    let trailData = null;

    const result = await runPipeline({
      thesisText: thesis.trim(),
      exchange: ex,
      forceExecute: false, // AGENTS.md: never forceExecute in real UI path
      confirmGate: async (data) => {
        // Capture the trail data but don't approve — approval comes from
        // the /api/pipeline/confirm endpoint.
        trailData = data;
        return false;
      },
      orderAmount: 1,
    });

    // If synthesis declined, there's no trailData from confirmGate
    // (pipeline returns before reaching the gate). Build trail from stages.
    const trail = {
      parse: result.stages.parse || null,
      match: result.stages.match || null,
      bookState: result.stages.bookState || null,
      critique: result.stages.critique || null,
      synthesis: result.stages.synthesis || null,
    };

    const declined = !!result.declinedReason;
    const synthesisProceeds =
      result.stages.synthesis?.output?.proceed === true;

    let pipelineId = null;
    if (synthesisProceeds && trailData) {
      // Store state for the confirm phase
      pipelineId = storePipelineState({
        trailData,
        result,
        thesis: thesis.trim(),
        createdAt: Date.now(),
      });
    }

    res.json({
      pipelineId,
      declined,
      declinedReason: result.declinedReason || null,
      synthesisProceeds,
      trail,
    });
  } catch (err) {
    console.error("[API /api/pipeline] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pipeline/confirm
 * Executes the trade for a previously-approved pipeline run.
 * Expects { pipelineId } in the body.
 */
app.post("/api/pipeline/confirm", async (req, res) => {
  try {
    const { pipelineId } = req.body;
    if (!pipelineId) {
      return res.status(400).json({ error: "Missing 'pipelineId'" });
    }

    const state = pendingPipelines.get(pipelineId);
    if (!state) {
      return res.status(404).json({
        error: "Pipeline not found or expired. Re-submit the thesis.",
      });
    }

    // Remove from pending — one-shot use
    pendingPipelines.delete(pipelineId);

    const ex = await getExchange();
    const { trailData } = state;
    const { parsed, matched, recommendedSide, decision } = trailData;

    // ─── Refresh Market Registry ──────────────────────────────────────
    // The singleton exchange's market registry may be stale — Event
    // Contract markets rotate/expire on testnet while the page is open.
    // Force a full reload so the symbol registry is current.
    await ex.loadMarkets(true);

    // ─── Build Tradable Symbol ────────────────────────────────────────
    const targetSide = decision.side || recommendedSide || "YES";
    const tradableSymbol =
      targetSide === "NO"
        ? matched.symbol.replace(/#YES$/i, "#NO")
        : matched.symbol.replace(/#NO$/i, "#YES");

    // ─── Validate Symbol Exists in Registry ───────────────────────────
    // After reloading, verify the tradable symbol is known to the SDK.
    // If the market expired/rotated while the user reviewed the
    // reasoning trail, fail safely instead of submitting a stale order.
    let tradable;
    try {
      tradable = ex.market(tradableSymbol);
    } catch {
      return res.status(409).json({
        error:
          `Market no longer available: "${tradableSymbol}". ` +
          `The Event Contract may have expired or rotated while you ` +
          `reviewed the reasoning trail. Please re-submit your thesis ` +
          `to discover the current market.`,
      });
    }

    // ─── Verify Market Is Still Tradable ──────────────────────────────
    // Check that the on-chain market has not settled or been voided.
    const marketInfo = ex.markets[tradable.marketSymbol];
    if (marketInfo && marketInfo.active === false) {
      return res.status(409).json({
        error:
          `Market "${tradable.marketSymbol}" is no longer active ` +
          `(status: ${marketInfo.status || "inactive"}). ` +
          `The contract may have settled or been voided. ` +
          `Please re-submit your thesis.`,
      });
    }

    // ─── Check Expiry ─────────────────────────────────────────────────
    if (marketInfo && marketInfo.expiry) {
      const nowSec = Math.floor(Date.now() / 1000);
      const expirySec = typeof marketInfo.expiry === "bigint"
        ? Number(marketInfo.expiry)
        : Number(marketInfo.expiry);
      if (expirySec <= nowSec) {
        return res.status(409).json({
          error:
            `Market "${tradable.marketSymbol}" has expired ` +
            `(expiry: ${new Date(expirySec * 1000).toISOString()}). ` +
            `Please re-submit your thesis to discover the current market.`,
        });
      }
    }

    // ─── Execute Order ────────────────────────────────────────────────
    const placed = await ex.createOrder(
      tradableSymbol,
      "market",
      "buy",
      1
    );

    // Confirm fill via watchOrders
    let orderResult = placed;
    if (placed.status === "open") {
      while (orderResult.status === "open") {
        const orders = await ex.watchOrders(tradableSymbol);
        const mine = orders.find((o) => o.id === placed.id);
        if (!mine || mine.status !== "open") {
          orderResult = mine || orderResult;
          break;
        }
        orderResult = mine;
      }
    }

    // ─── Log TradeRecord ──────────────────────────────────────────────
    const { buildTradeRecord, appendTradeRecord } = await import(
      "./calibration/tradeLog.js"
    );

    const tradeRecord = buildTradeRecord({
      parsed,
      matched,
      recommendedSide,
      critique: trailData.critique,
      decision,
      orderResult,
      tradableSymbol,
    });

    appendTradeRecord(tradeRecord);

    res.json({
      success: true,
      tradeRecord,
      order: {
        id: orderResult.id,
        status: orderResult.status,
        price: orderResult.price,
        filled: orderResult.filled,
        txHash:
          orderResult.txHash ||
          orderResult.info?.hash ||
          null,
      },
    });
  } catch (err) {
    console.error("[API /api/pipeline/confirm] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/trades
 * Returns all TradeRecords from data/trades.json.
 */
app.get("/api/trades", (_req, res) => {
  try {
    const trades = readTradeLog();
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/calibration
 * Returns the calibration summary computed from our own TradeRecords.
 */
app.get("/api/calibration", (_req, res) => {
  try {
    const trades = readTradeLog();
    const summary = computeCalibrationSummary(trades);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/settlement/poll
 * Polls all open trades for settlement and updates data/trades.json.
 */
app.post("/api/settlement/poll", async (_req, res) => {
  try {
    const ex = await getExchange();
    const result = await pollSettledTrades(ex);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/markets
 * Returns live binary markets for the market browser.
 */
app.get("/api/markets", async (req, res) => {
  try {
    const ex = await getExchange();
    const filter = {};
    if (req.query.asset) filter.asset = req.query.asset;
    if (req.query.limit) filter.limit = parseInt(req.query.limit, 10);
    const markets = await ex.client.listLiveBinaryMarkets(filter);
    res.json(
      markets.map((m) => ({
        id: m.id,
        symbol: m.symbol,
        asset: m.asset,
        expiry: m.expiry,
        interval: m.interval,
        lastPrice: m.lastPrice,
        status: m.status,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  SKEPTICAL COPILOT — http://localhost:${PORT}\n`);
});
