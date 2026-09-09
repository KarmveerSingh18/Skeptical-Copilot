/* ═══════════════════════════════════════════════════════════════════════════
   SKEPTICAL COPILOT — Client-Side Dashboard Logic
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────────────────────────────────
let currentPipelineId = null;
let trades = [];
let calibration = null;

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadTrades();
  loadCalibration();
  // Auto-refresh every 30s
  setInterval(() => {
    loadTrades();
    loadCalibration();
  }, 30000);
});

// ─── API Helpers ─────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Thesis Submission ───────────────────────────────────────────────────────
async function submitThesis() {
  const input = document.getElementById("thesis-input");
  const btn = document.getElementById("btn-submit");
  const thesis = input.value.trim();

  if (!thesis) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> ANALYZING...';
  currentPipelineId = null;

  showStatus("Submitting thesis to adversarial pipeline...", "pending");
  showReasoningLoading();

  try {
    const result = await api("POST", "/api/pipeline", { thesis });

    renderReasoningTrail(result);
    updateMarketInfo(result.trail);

    if (result.synthesisProceeds && result.pipelineId) {
      currentPipelineId = result.pipelineId;
      showStatus("Synthesis recommends PROCEED — awaiting your approval.", "success");
    } else if (result.declined) {
      showStatus(`Pipeline declined: ${result.declinedReason}`, "error");
    }

    // Update header SDK dot to green on first successful call
    const dot = document.querySelector("#header-connection .dot");
    dot.className = "dot dot-ok";
  } catch (err) {
    showStatus(`Error: ${err.message}`, "error");
    renderReasoningError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">▶</span> SUBMIT THESIS';
  }
}

// ─── Confirm / Reject Trade ──────────────────────────────────────────────────
async function confirmTrade() {
  if (!currentPipelineId) return;

  const approveBtn = document.querySelector(".btn-approve");
  const rejectBtn = document.querySelector(".btn-reject");
  if (approveBtn) {
    approveBtn.disabled = true;
    approveBtn.textContent = "EXECUTING...";
  }
  if (rejectBtn) rejectBtn.disabled = true;

  showStatus("Executing trade on testnet...", "pending");

  try {
    const result = await api("POST", "/api/pipeline/confirm", {
      pipelineId: currentPipelineId,
    });

    currentPipelineId = null;
    showStatus(
      `Trade #${result.tradeRecord?.tradeNumber} executed — ${result.tradeRecord?.symbol} @ ${result.order?.price}`,
      "success"
    );

    // Remove confirm buttons
    const actions = document.querySelector(".confirm-actions");
    if (actions) {
      actions.innerHTML =
        '<span style="color: var(--green); font-size: 12px; font-weight: 600; letter-spacing: 1px;">✓ EXECUTED</span>';
    }

    // Refresh positions
    loadTrades();
  } catch (err) {
    showStatus(`Execution error: ${err.message}`, "error");
    if (approveBtn) {
      approveBtn.disabled = false;
      approveBtn.textContent = "APPROVE";
    }
    if (rejectBtn) rejectBtn.disabled = false;
  }
}

function rejectTrade() {
  currentPipelineId = null;
  showStatus("Trade rejected by user.", "error");
  const actions = document.querySelector(".confirm-actions");
  if (actions) {
    actions.innerHTML =
      '<span style="color: var(--red); font-size: 12px; font-weight: 600; letter-spacing: 1px;">✗ REJECTED</span>';
  }
}

// ─── Status Bar ──────────────────────────────────────────────────────────────
function showStatus(msg, type) {
  const el = document.getElementById("thesis-status");
  el.className = "status-bar";
  if (type === "error") el.classList.add("status-error");
  else if (type === "success") el.classList.add("status-success");
  el.textContent = msg;
  el.classList.remove("hidden");
}

// ─── Market Info Strip ───────────────────────────────────────────────────────
function updateMarketInfo(trail) {
  const wrap = document.getElementById("market-info");
  if (!trail?.match?.matched) {
    wrap.classList.add("hidden");
    return;
  }

  const m = trail.match.matched;
  const bs = trail.bookState;

  document.getElementById("mi-symbol").textContent = m.symbol || m.id?.slice(0, 16);
  document.getElementById("mi-expiry").textContent = formatExpiry(m.expiry);
  document.getElementById("mi-mid").textContent =
    bs?.mid != null ? Number(bs.mid).toFixed(4) : (m.lastPrice || "—");
  document.getElementById("mi-spread").textContent =
    bs?.bestBid != null && bs?.bestAsk != null
      ? `${Number(bs.bestBid).toFixed(4)} / ${Number(bs.bestAsk).toFixed(4)}`
      : "—";

  wrap.classList.remove("hidden");
}

// ─── Reasoning Trail Renderer ────────────────────────────────────────────────
function showReasoningLoading() {
  const body = document.getElementById("reasoning-body");
  body.innerHTML = `
    <div class="stage-processing">
      <span class="spinner"></span>
      Running adversarial analysis pipeline...
    </div>
  `;
}

function renderReasoningError(msg) {
  const body = document.getElementById("reasoning-body");
  body.innerHTML = `
    <div class="stage-block">
      <div class="stage-header">
        <span class="stage-dot" style="background: var(--red)"></span>
        <span class="stage-name">ERROR</span>
      </div>
      <div class="stage-body" style="color: var(--red)">${escapeHtml(msg)}</div>
    </div>
  `;
}

function renderReasoningTrail(result) {
  const body = document.getElementById("reasoning-body");
  const trail = result.trail;
  let html = "";

  // Stage 1: Parse
  if (trail.parse) {
    const p = trail.parse.output;
    html += buildStageBlock({
      num: "01",
      name: "PARSE",
      latency: trail.parse.latencyMs,
      dotColor: "var(--green)",
      content: `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 16px; font-family:var(--font-mono); font-size:11px;">
          <div><span style="color:var(--text-muted)">ASSET</span> <span>${escapeHtml(p.asset || "—")}</span></div>
          <div><span style="color:var(--text-muted)">DIR</span> <span>${escapeHtml(p.direction || "—")}</span></div>
          <div><span style="color:var(--text-muted)">WINDOW</span> <span>${escapeHtml(p.preferredWindow || "—")}</span></div>
          <div><span style="color:var(--text-muted)">STAKE</span> <span>${p.stake ?? "—"}</span></div>
        </div>
        ${p.rawThesis ? `<div style="margin-top:8px; color:var(--text-muted); font-size:11px; font-style:italic;">"${escapeHtml(truncate(p.rawThesis, 200))}"</div>` : ""}
      `,
    });
  }

  // Stage 1.5: Match
  if (trail.match) {
    const m = trail.match;
    if (m.success && m.matched) {
      html += buildStageBlock({
        num: "·",
        name: "MARKET MATCH",
        latency: null,
        dotColor: "var(--green)",
        content: `
          <div style="font-family:var(--font-mono); font-size:11px;">
            <div><span style="color:var(--text-muted)">SYMBOL</span> ${escapeHtml(m.matched.symbol)}</div>
            <div><span style="color:var(--text-muted)">SIDE</span> <span style="color:${m.recommendedSide === "YES" ? "var(--green)" : "var(--red)"}">${m.recommendedSide}</span></div>
            <div><span style="color:var(--text-muted)">EXPIRY</span> ${formatExpiry(m.matched.expiry)}</div>
          </div>
        `,
        collapsed: true,
      });
    } else {
      html += buildStageBlock({
        num: "·",
        name: "MARKET MATCH",
        latency: null,
        dotColor: "var(--red)",
        content: `<span style="color:var(--red)">No matching market found: ${escapeHtml(m.reason || "unknown")}</span>`,
      });
    }
  }

  // Stage 2: Critique
  if (trail.critique) {
    const c = trail.critique.output;
    const severity = c.severityScore ?? 0;
    const severityColor =
      severity >= 7 ? "var(--red)" : severity >= 4 ? "var(--yellow)" : "var(--green)";

    html += buildStageBlock({
      num: "02",
      name: "ADVERSARIAL CRITIC",
      latency: trail.critique.latencyMs,
      dotColor: severityColor,
      content: `
        <div>${escapeHtml(c.counterArgument || "No critique generated.")}</div>
        <div class="severity-bar-wrap">
          <span class="severity-label">SEVERITY ${severity}/10</span>
          <div class="severity-bar">
            <div class="severity-fill" style="width:${severity * 10}%; background:${severityColor}"></div>
          </div>
        </div>
        ${c.weaknesses ? `<div style="margin-top:8px; font-size:11px; color:var(--text-muted);">Weaknesses: ${escapeHtml(Array.isArray(c.weaknesses) ? c.weaknesses.join(", ") : c.weaknesses)}</div>` : ""}
      `,
    });
  }

  // Stage 3: Synthesis + Decision
  if (trail.synthesis) {
    const s = trail.synthesis.output || {};
    const proceeds = s.proceed === true;
    const verdict = proceeds ? "PROCEED" : "DECLINE";
    const verdictClass = proceeds ? "proceed" : "decline";
    const edgeVal = s.edge ?? s.estimatedEdge;
    const edgeFormatted = edgeVal != null
      ? `${edgeVal >= 0 ? "+" : ""}${(edgeVal * 100).toFixed(1)}%`
      : "—";

    html += buildStageBlock({
      num: "03",
      name: "DECISION SYNTHESIS",
      latency: trail.synthesis.latencyMs,
      dotColor: proceeds ? "var(--green)" : "var(--red)",
      content: `
        <div class="decision-block">
          <div class="decision-verdict ${verdictClass}">${verdict}</div>
          <div class="decision-meta">
            <div class="decision-meta-item">
              <span class="decision-meta-label">CONFIDENCE</span>
              <span class="decision-meta-value">${s.statedConfidence != null ? (s.statedConfidence * 100).toFixed(1) + "%" : "—"}</span>
            </div>
            <div class="decision-meta-item">
              <span class="decision-meta-label">SIDE</span>
              <span class="decision-meta-value" style="color:${s.side === "YES" ? "var(--green)" : s.side === "NO" ? "var(--red)" : "var(--text-bright)"}">${s.side || "—"}</span>
            </div>
            <div class="decision-meta-item">
              <span class="decision-meta-label">EDGE</span>
              <span class="decision-meta-value">${edgeFormatted}</span>
            </div>
          </div>
          <div class="decision-reasoning">${escapeHtml(s.reasoning || "")}</div>
          ${
            proceeds && result.pipelineId
              ? `
            <div class="confirm-actions">
              <button class="btn-small btn-approve" onclick="confirmTrade()">APPROVE</button>
              <button class="btn-small btn-reject" onclick="rejectTrade()">REJECT</button>
            </div>
          `
              : ""
          }
        </div>
      `,
    });
  }

  body.innerHTML = html;
}

function buildStageBlock({ num, name, latency, dotColor, content, collapsed }) {
  const id = `stage-${num}-${Date.now()}`;
  return `
    <div class="stage-block">
      <div class="stage-header" onclick="toggleStage('${id}')">
        <span class="stage-number">${num}</span>
        <span class="stage-dot" style="background:${dotColor}"></span>
        <span class="stage-name">${name}</span>
        ${latency != null ? `<span class="stage-latency">${latency}ms</span>` : ""}
      </div>
      <div class="stage-body ${collapsed ? "collapsed" : ""}" id="${id}">
        ${content}
      </div>
    </div>
  `;
}

function toggleStage(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("collapsed");
}

// ─── Positions List ──────────────────────────────────────────────────────────
async function loadTrades() {
  try {
    trades = await api("GET", "/api/trades");
    renderTrades();
    updateHeaderStats();
  } catch {
    // Silent fail on auto-refresh
  }
}

function renderTrades() {
  const body = document.getElementById("positions-body");

  if (!trades.length) {
    body.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">◇</span>
        <p>No trades recorded yet.</p>
      </div>
    `;
    return;
  }

  // Most recent first
  const sorted = [...trades].reverse();

  body.innerHTML = sorted
    .map((t) => {
      const hasOutcome = t.outcome === 0 || t.outcome === 1;
      const isVoided = t.outcome === "voided";
      const isOpen = !hasOutcome && !isVoided;

      let statusDotClass, statusText;
      if (isOpen) {
        statusDotClass = "dot-pending";
        statusText = "OPEN";
      } else if (isVoided) {
        statusDotClass = "";
        statusText = "VOIDED";
      } else if (t.outcome === 1) {
        statusDotClass = "dot-ok";
        statusText = "WIN";
      } else {
        statusDotClass = "dot-error";
        statusText = "LOSS";
      }

      const brierText =
        hasOutcome && t.statedConfidence != null
          ? Math.pow(t.statedConfidence - t.outcome, 2).toFixed(4)
          : "—";

      const expiryText = isOpen ? formatExpiry(t.expiry) : "SETTLED";

      return `
        <div class="trade-card">
          <div class="trade-card-head">
            <span class="trade-number">#${t.tradeNumber || "?"}</span>
            <span class="trade-status">
              <span class="dot ${statusDotClass}"></span>
              ${statusText}
            </span>
          </div>
          <div class="trade-symbol">${escapeHtml(t.symbol || t.marketId?.slice(0, 20))}</div>
          <div class="trade-details">
            <div class="trade-detail">
              <span class="trade-detail-label">SIDE</span>
              <span class="trade-detail-value ${t.proposedSide === "YES" ? "side-yes" : "side-no"}">${t.proposedSide}</span>
            </div>
            <div class="trade-detail">
              <span class="trade-detail-label">FILL</span>
              <span class="trade-detail-value">${t.fillPrice != null ? t.fillPrice.toFixed(4) : "—"}</span>
            </div>
            <div class="trade-detail">
              <span class="trade-detail-label">CONF</span>
              <span class="trade-detail-value">${t.statedConfidence != null ? (t.statedConfidence * 100).toFixed(1) + "%" : "—"}</span>
            </div>
            <div class="trade-detail">
              <span class="trade-detail-label">BRIER</span>
              <span class="trade-detail-value">${brierText}</span>
            </div>
            <div class="trade-detail">
              <span class="trade-detail-label">EXPIRY</span>
              <span class="trade-detail-value">${expiryText}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

// ─── Calibration ─────────────────────────────────────────────────────────────
async function loadCalibration() {
  try {
    calibration = await api("GET", "/api/calibration");
    renderCalibration();
    updateHeaderStats();
  } catch {
    // Silent fail
  }
}

async function pollSettlement() {
  const btn = document.querySelector("#panel-calibration .btn-accent");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "POLLING...";
  }

  try {
    await api("POST", "/api/settlement/poll");
    await loadTrades();
    await loadCalibration();
    showStatus("Settlement poll complete.", "success");
  } catch (err) {
    showStatus(`Settlement poll error: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "POLL SETTLEMENT";
    }
  }
}

function renderCalibration() {
  if (!calibration) return;

  const statsEl = document.getElementById("calibration-stats");

  // Summary cards
  const brier = calibration.overallBrierScore;
  const brierClass =
    brier === null ? "neutral" : brier <= 0.15 ? "good" : brier <= 0.3 ? "neutral" : "bad";

  let html = `
    <div class="cal-summary">
      <div class="cal-summary-item">
        <span class="cal-summary-label">AVG BRIER</span>
        <span class="cal-summary-value ${brierClass}">${brier != null ? brier.toFixed(4) : "—"}</span>
      </div>
      <div class="cal-summary-item">
        <span class="cal-summary-label">WIN RATE</span>
        <span class="cal-summary-value">${calibration.overallWinRate != null ? (calibration.overallWinRate * 100).toFixed(1) + "%" : "—"}</span>
      </div>
      <div class="cal-summary-item">
        <span class="cal-summary-label">SETTLED</span>
        <span class="cal-summary-value">${calibration.settledTrades} / ${calibration.totalTrades}</span>
      </div>
    </div>
  `;

  // Bucket table
  if (calibration.buckets && calibration.buckets.length > 0) {
    html += `
      <table class="cal-table">
        <thead>
          <tr>
            <th>BUCKET</th>
            <th>N</th>
            <th>PREDICTED</th>
            <th>ACTUAL</th>
            <th>BRIER</th>
            <th>CAL ERR</th>
          </tr>
        </thead>
        <tbody>
          ${calibration.buckets
            .map(
              (b) => `
            <tr>
              <td>${b.bucket}</td>
              <td>${b.count}${b.openCount ? ` <span style="color:var(--text-muted)">(+${b.openCount} open)</span>` : ""}</td>
              <td>${b.meanConfidence != null ? (b.meanConfidence * 100).toFixed(1) + "%" : "—"}</td>
              <td>${b.actualWinRate != null ? (b.actualWinRate * 100).toFixed(1) + "%" : "—"}</td>
              <td>${b.brierScore != null ? b.brierScore.toFixed(4) : "—"}</td>
              <td style="color:${calErrColor(b.calibrationError)}">${b.calibrationError != null ? (b.calibrationError > 0 ? "+" : "") + (b.calibrationError * 100).toFixed(1) + "%" : "—"}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  statsEl.innerHTML = html;

  // Render chart
  renderCalibrationChart();
}

function calErrColor(err) {
  if (err == null) return "var(--text-muted)";
  const abs = Math.abs(err);
  if (abs <= 0.05) return "var(--green)";
  if (abs <= 0.15) return "var(--yellow)";
  return "var(--red)";
}

// ─── Canvas Calibration Chart ────────────────────────────────────────────────
function renderCalibrationChart() {
  const canvas = document.getElementById("calibration-chart");
  if (!canvas || !calibration) return;

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.clientWidth - 24;
  const h = 260;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.scale(dpr, dpr);

  // Chart area
  const pad = { top: 24, right: 20, bottom: 36, left: 44 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  // Background
  ctx.fillStyle = "#080808";
  ctx.fillRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = "#1c1c1c";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (ch / 5) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cw, y);
    ctx.stroke();
  }

  // Labels
  ctx.fillStyle = "#444";
  ctx.font = "10px 'JetBrains Mono'";
  ctx.textAlign = "right";
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (ch / 5) * i;
    const val = 100 - i * 20;
    ctx.fillText(val + "%", pad.left - 6, y + 3);
  }

  // X-axis labels (bucket centers)
  const buckets = calibration.buckets || [];
  const bucketCenters = [0.545, 0.645, 0.745, 0.845, 0.95];
  const bucketLabels = ["50-59", "60-69", "70-79", "80-89", "90-100"];

  ctx.textAlign = "center";
  for (let i = 0; i < bucketLabels.length; i++) {
    const x = pad.left + (i / (bucketLabels.length - 1)) * cw;
    ctx.fillText(bucketLabels[i] + "%", x, h - pad.bottom + 16);
  }

  // Axis labels
  ctx.save();
  ctx.translate(12, pad.top + ch / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#555";
  ctx.font = "9px 'JetBrains Mono'";
  ctx.textAlign = "center";
  ctx.fillText("ACTUAL WIN RATE", 0, 0);
  ctx.restore();

  ctx.fillStyle = "#555";
  ctx.textAlign = "center";
  ctx.fillText("STATED CONFIDENCE", pad.left + cw / 2, h - 4);

  // Perfect calibration diagonal
  ctx.strokeStyle = "#2a2a2a";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + ch);
  ctx.lineTo(pad.left + cw, pad.top);
  ctx.stroke();
  ctx.setLineDash([]);

  // Label for diagonal
  ctx.fillStyle = "#333";
  ctx.font = "9px 'JetBrains Mono'";
  ctx.save();
  ctx.translate(pad.left + cw * 0.75, pad.top + ch * 0.22);
  ctx.rotate(-Math.atan2(ch, cw));
  ctx.fillText("PERFECT", 0, -4);
  ctx.restore();

  // Plot data points (buckets with actual data)
  if (buckets.length > 0) {
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.count === 0 || b.actualWinRate == null) continue;

      const x = pad.left + (i / (bucketLabels.length - 1)) * cw;
      const y = pad.top + ch - b.actualWinRate * ch;

      // Predicted point on the diagonal (for reference)
      const yPred = pad.top + ch - bucketCenters[i] * ch;

      // Vertical line from predicted to actual (calibration error)
      ctx.strokeStyle = b.actualWinRate >= bucketCenters[i]
        ? "rgba(29, 185, 84, 0.3)"
        : "rgba(224, 62, 62, 0.3)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, yPred);
      ctx.lineTo(x, y);
      ctx.stroke();

      // Actual win rate dot
      ctx.fillStyle = "#e05a1b";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();

      // Dot border
      ctx.strokeStyle = "#ff6b2b";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();

      // Count label
      ctx.fillStyle = "#777";
      ctx.font = "9px 'JetBrains Mono'";
      ctx.textAlign = "center";
      ctx.fillText(`n=${b.count}`, x, y - 10);
    }
  }

  // If no settled data, show placeholder text
  if (!buckets.some((b) => b.count > 0)) {
    ctx.fillStyle = "#333";
    ctx.font = "12px 'JetBrains Mono'";
    ctx.textAlign = "center";
    ctx.fillText("Awaiting settled trade data", pad.left + cw / 2, pad.top + ch / 2);
  }
}

// ─── Header Stats ────────────────────────────────────────────────────────────
function updateHeaderStats() {
  document.getElementById("header-trades").textContent = trades.length || "0";

  if (calibration) {
    document.getElementById("header-brier").textContent =
      calibration.overallBrierScore != null
        ? calibration.overallBrierScore.toFixed(4)
        : "—";
    document.getElementById("header-winrate").textContent =
      calibration.overallWinRate != null
        ? (calibration.overallWinRate * 100).toFixed(1) + "%"
        : "—";
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + "…";
}

function formatExpiry(expirySec) {
  if (!expirySec) return "—";
  const nowMs = Date.now();
  const expiryMs = Number(expirySec) * 1000;
  const diff = expiryMs - nowMs;

  if (diff <= 0) return "EXPIRED";

  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);

  if (h > 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return `${h}h ${m}m`;
}

// ─── Resize handler for chart ────────────────────────────────────────────────
window.addEventListener("resize", () => {
  if (calibration) renderCalibrationChart();
});
