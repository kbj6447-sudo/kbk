const api = {
  scanner: "/api/scanner",
  quote: (symbol) => `/api/quote?symbol=${encodeURIComponent(symbol)}`,
  exchange: "/api/exchange",
  backtest: (date) => `/api/backtest?date=${encodeURIComponent(date || "")}`,
};

const state = { items: [], debug: null, exchangeRate: null, activeStage: "PRE-SURGE", activeVerdict: "all" };
const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("en-US");

const label = {
  candidate: "\ud6c4\ubcf4",
  passed: "\ud1b5\uacfc",
  pre: "\uae09\ub4f1 \uc804\uc870",
  early: "\ucd08\uae30 \ud3ed\ubc1c",
  momentum: "\ucd94\uac00 \ud655\uc7a5",
  risk: "\uacfc\uc5f4 \uc704\ud5d8",
  directSearch: "\uc9c1\uc811 \uac80\uc0c9 \uacb0\uacfc",
  included: "\uc0c1\uc704 \uc2a4\uce94 \ud6c4\ubcf4\uad70 \ud3ec\ud568",
  excluded: "\uc0c1\uc704 \uc2a4\uce94 \ud6c4\ubcf4\uad70 \ubbf8\ud3ec\ud568",
  noPre: "\uc544\uc9c1 \uac15\ud55c \uc804\uc870 \ud6c4\ubcf4\uac00 \uc5c6\uc2b5\ub2c8\ub2e4",
  noEarly: "\ucd08\uae30 \ud3ed\ubc1c \ud6c4\ubcf4\uac00 \uc5c6\uc2b5\ub2c8\ub2e4",
  noMomentum: "\ucd94\uac00 \ud655\uc7a5 \ud6c4\ubcf4\uac00 \uc5c6\uc2b5\ub2c8\ub2e4",
  noRisk: "\uacfc\uc5f4 \uc704\ud5d8 \ud6c4\ubcf4\uac00 \uc5c6\uc2b5\ub2c8\ub2e4",
  searching: "\uc885\ubaa9 \ubd84\uc11d \uc911...",
  scanFailed: "\uc2a4\uce94 \uc2e4\ud328",
  searchFailed: "\uc870\ud68c \uc2e4\ud328",
  backtestFailed: "\ubc31\ud14c\uc2a4\ud2b8 \uc2e4\ud328",
};

const primaryBenchmarks = ["TDIC", "WOK", "DXF", "LNKS", "YOOV"];
const verdictFilters = [
  { key: "all", title: "\uc804\uccb4" },
  { key: "buy", title: "\ud22c\uc790\ud558\uc138\uc694" },
  { key: "watch", title: "\uc18c\uc561 \ud22c\uc790 \ub610\ub294 \uad00\uc2ec" },
  { key: "hold", title: "\ubcf4\ub958\ud558\uc138\uc694" },
  { key: "avoid", title: "\uc0ac\uc9c0 \ub9c8\uc138\uc694" },
];

function cleanSymbol(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.message || `API error ${response.status}`);
  return body.data || body;
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value, digits = 3) {
  const n = num(value);
  if (n === null) return "-";
  return `$${n.toFixed(n >= 10 ? 2 : digits)}`;
}

function won(value) {
  const n = num(value);
  if (n === null || !state.exchangeRate) return "";
  return `KRW ${Math.round(n * state.exchangeRate).toLocaleString("ko-KR")}`;
}

function pct(value) {
  const n = num(value);
  if (n === null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function compact(value) {
  const n = num(value);
  if (n === null) return "-";
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return fmt.format(Math.round(n));
}

function moveOf(item) {
  return Math.max(num(item.preMarketChangePercent) ?? -999, num(item.changePercent) ?? -999);
}

function stageTitle(stage) {
  if (stage === "PRE-SURGE") return label.pre;
  if (stage === "EARLY SURGE") return label.early;
  if (stage === "MOMENTUM EXPANSION") return label.momentum;
  return label.risk;
}

function tagKo(tag) {
  const map = {
    ai: "AI",
    bio: "\ubc14\uc774\uc624",
    merger: "\ud569\ubcd1",
    ticker: "\ud2f0\ucee4 \ubcc0\uacbd",
    quantum: "\uc591\uc790",
    defense: "\ubc29\uc0b0/\uc6b0\uc8fc",
    compliance: "\uc0c1\uc7a5 \uc720\uc9c0 \uc774\uc288",
    split: "\uc8fc\uc2dd\ubcd1\ud569",
    offering: "\uc720\uc99d/\uc6cc\ub7f0\ud2b8",
    "offshore-smallcap": "\ud574\uc678 \uc18c\ud615\uc8fc",
    microcap: "\ucd08\uc18c\ud615\uc8fc",
    "low-price": "\uc800\uac00\uc8fc",
  };
  return map[tag] || tag;
}

function reasonKo(reason) {
  const text = String(reason || "");
  let match = text.match(/^Premarket move (.+)$/);
  if (match) return `\uc7a5\uc804 \ub4f1\ub77d\ub960 ${match[1]}`;
  match = text.match(/^Premarket volume (.+)$/);
  if (match) return `\uc7a5\uc804 \uac70\ub798\ub7c9 ${match[1]}`;
  match = text.match(/^Relative volume (.+)$/);
  if (match) return `\ud3c9\uade0 \ub300\ube44 \uac70\ub798\ub7c9 ${match[1]}`;
  match = text.match(/^(.+) pattern (.+)% similar$/);
  if (match) return `${match[1]} \uae09\ub4f1 \ud328\ud134\uacfc ${match[2]}% \uc720\uc0ac`;
  match = text.match(/^Story tags: (.+)$/);
  if (match) return `\uc2a4\ud1a0\ub9ac/\ud14c\ub9c8: ${match[1].split(",").map((tag) => tagKo(tag.trim())).join(", ")}`;
  match = text.match(/^RSI (.+)$/);
  if (match) return `RSI ${match[1]}`;
  const exact = {
    "Micro/small market cap": "\uc2dc\ucd1d\uc774 \uc791\uc740 \uc18c\ud615/\ucd08\uc18c\ud615\uc8fc",
    "Low-price setup": "5\ub2ec\ub7ec \uc774\ud558 \uc800\uac00\uc8fc \uad6c\uac04",
    "News/story signal detected": "\ub274\uc2a4/\uc2a4\ud1a0\ub9ac \uc2e0\ud638 \uac10\uc9c0",
    "Recent 8-K filing signal": "\ucd5c\uadfc 8-K \uacf5\uc2dc/\uad6c\uc870 \uc774\ubca4\ud2b8 \uc2e0\ud638",
    "Pullback or base with volume signal": "\ub20c\ub9bc\ubaa9/\ubc14\ub2e5\uad8c\uc5d0\uc11c \uac70\ub798\ub7c9 \uc720\uc785",
    "Holding above intraday VWAP": "\uc77c\uc911 VWAP \uc704\uc5d0\uc11c \uc720\uc9c0",
    "High dilution/listing/overheat risk": "\ud76c\uc11d/\uc0c1\uc7a5 \uc774\uc288/\uacfc\uc5f4 \uc704\ud5d8 \ub192\uc74c",
    "Low data coverage, watch only after stronger signal": "\ub370\uc774\ud130\uac00 \ubd80\uc871\ud574 \uac15\ud55c \uc2e0\ud638 \ud655\uc778 \ud544\uc694",
  };
  return exact[text] || text;
}

function sourceKo(tag) {
  const map = {
    "stockanalysis-premarket": "\uc7a5\uc804 \uae09\ub4f1",
    "stockanalysis-gainers": "\uc815\uaddc\uc7a5 \uae09\ub4f1",
    "yahoo-day-gainers": "\uc57c\ud6c4 \uae09\ub4f1",
    "nasdaq-low-price-universe": "\uc800\uac00\uc8fc \uc720\ub2c8\ubc84\uc2a4",
    "nasdaq-volume-surge-low-price": "\uac70\ub798\ub7c9 \uae09\uc99d",
    "news-story-signal": "\ub274\uc2a4/\uc2a4\ud1a0\ub9ac",
    "benchmark-catalyst-seed": "\uae30\uc900 \uae09\ub4f1\uc8fc \ud328\ud134",
    "sec-8k-signal": "8-K \uacf5\uc2dc",
    "structural-event-monitor": "\uad6c\uc870 \uc774\ubca4\ud2b8",
    "direct-watch-symbol": "\uc9d1\uc911 \uac10\uc2dc",
    "yahoo-1m-extended": "1\ubd84\ubd09/\uc7a5\uc804",
    "remote-scanner": "\uae30\uc874 \uc2a4\uce90\ub108",
  };
  return map[tag] || tag;
}

function sourceNameKo(name) {
  const text = String(name || "");
  if (text.includes("stockanalysis-premarket")) return "A. \uc7a5\uc804 \uae09\ub4f1\uc8fc";
  if (text.includes("stockanalysis-regular")) return "B. \uc815\uaddc\uc7a5 \uae09\ub4f1\uc8fc";
  if (text.includes("yahoo-regular")) return "B. \uc57c\ud6c4 \uc815\uaddc\uc7a5 \uae09\ub4f1\uc8fc";
  if (text.includes("nasdaq-nyse-amex")) return "C. NASDAQ/NYSE/AMEX \uc800\uac00\uc8fc";
  if (text.includes("realtime-volume")) return "C. \uc2e4\uc2dc\uac04 \uac70\ub798\ub7c9 \uae09\uc99d";
  if (text.includes("news-story")) return "D. \ub274\uc2a4/\ud14c\ub9c8 \uc774\uc0c1\uc9d5\ud6c4";
  if (text.includes("sec-8k")) return "E. 8-K \uacf5\uc2dc/\uad6c\uc870 \uc774\ubca4\ud2b8";
  if (text.includes("legacy")) return "\uae30\uc874 \uc6d0\uaca9 \uc2a4\uce90\ub108";
  return text;
}

function vwapKo(value) {
  if (value === "above") return "\uc704";
  if (value === "below") return "\uc544\ub798";
  return "\ud655\uc778 \ubd88\uac00";
}

function vwapDisplay(tech = {}) {
  if (tech.vwapStatus === "calculated") {
    const where = vwapKo(tech.vwapState);
    const price = num(tech.vwap);
    return price === null ? `\uacc4\uc0b0\ub428: ${where}` : `\uacc4\uc0b0\ub428: ${where} ${money(price)}`;
  }
  if (tech.vwapStatus === "insufficient-volume") return "\ub370\uc774\ud130 \ubd80\uc871";
  return "\uc870\ud68c \ub300\uae30";
}

function byStage(stage) {
  return filteredItems()
    .filter((item) => item.stage === stage)
    .sort((a, b) => (b.finalProbabilityScore || 0) - (a.finalProbabilityScore || 0));
}

function filteredItems() {
  if (state.activeVerdict === "all") return state.items;
  return state.items.filter((item) => tradeVerdict(item).tone === state.activeVerdict);
}

function verdictCount(key) {
  if (key === "all") return state.items.length;
  return state.items.filter((item) => tradeVerdict(item).tone === key).length;
}

function scorePill(name, value, danger = false) {
  const score = Math.round(num(value) ?? 0);
  return `<div class="score-chip ${danger ? "risk" : ""}"><span>${name}</span><b>${score}</b></div>`;
}

function meta(name, value, good = false) {
  return `<div class="meta-item"><div class="meta-label">${name}</div><div class="meta-val ${good ? "good" : ""}">${value}</div></div>`;
}

function similarityJudgement(score) {
  if (score >= 80) return "\ub9e4\uc6b0 \uc720\uc0ac - \uae09\ub4f1\uc8fc \uad6c\uc870\uc640 \ub9ce\uc774 \ub2ee\uc74c";
  if (score >= 65) return "\uc720\uc0ac - \ucd94\uac00 \ud655\uc778 \uac00\uce58 \uc788\uc74c";
  if (score >= 50) return "\ubd80\ubd84 \uc720\uc0ac - \uc2e0\ud638\uac00 \ubd80\uc871\ud568";
  return "\ub0ae\uc74c - \uae30\uc900 \uae09\ub4f1\uc8fc\uc640 \uad6c\uc870\uac00 \ub2e4\ub984";
}

function renderPatternComparison(item) {
  const matches = new Map((item.patternMatches || []).map((match) => [match.symbol, match.similarity]));
  const rows = primaryBenchmarks.map((symbol) => {
    const score = Math.round(num(matches.get(symbol)) ?? 0);
    const tone = score >= 80 ? "hot" : score >= 65 ? "warm" : score >= 50 ? "mid" : "cold";
    return `
      <div class="benchmark-row">
        <div class="benchmark-head">
          <strong>${symbol}</strong>
          <span class="${tone}">${score}%</span>
        </div>
        <div class="benchmark-bar"><i class="${tone}" style="width:${Math.max(4, Math.min(score, 100))}%"></i></div>
      </div>
    `;
  }).join("");
  const best = primaryBenchmarks
    .map((symbol) => ({ symbol, score: Math.round(num(matches.get(symbol)) ?? 0) }))
    .sort((a, b) => b.score - a.score)[0] || { symbol: "-", score: 0 };
  return `
    <div class="benchmark-box">
      <div class="benchmark-title">\uae30\uc900 \uae09\ub4f1\uc8fc 5\uc885 \uc720\uc0ac\ub3c4</div>
      <div class="benchmark-summary">
        <b>${best.symbol} ${best.score}%</b>
        <span>${similarityJudgement(best.score)}</span>
      </div>
      ${rows}
    </div>
  `;
}

function tradeVerdict(item) {
  const finalScore = num(item.finalProbabilityScore) ?? 0;
  const precursor = num(item.surgePrecursorScore) ?? 0;
  const expansion = num(item.momentumExpansionScore) ?? 0;
  const similarity = num(item.patternSimilarityScore) ?? 0;
  const risk = num(item.riskScore) ?? 0;
  const move = moveOf(item) ?? 0;
  const volumeRatio = num(item.volumeRatio) ?? 0;
  const preMarketVolume = num(item.preMarketVolume) ?? 0;
  const weakVolume = volumeRatio < 1 && preMarketVolume < 100_000;

  const reasons = [];
  if (finalScore < 38) reasons.push(`\ucd5c\uc885 \uc810\uc218 ${Math.round(finalScore)}\uc810`);
  if (expansion < 35) reasons.push(`\ud655\uc7a5 \uc810\uc218 ${Math.round(expansion)}\uc810`);
  if (weakVolume) reasons.push("\ud604\uc7ac \uac70\ub798\ub7c9 \uc2e0\ud638 \uc57d\ud568");
  if (risk >= 50) reasons.push(`\uc704\ud5d8 \uc810\uc218 ${Math.round(risk)}\uc810`);
  if (item.stage === "EXHAUSTION") reasons.push("\uacfc\uc5f4 \ub2e8\uacc4");
  if (move >= 120 && expansion < 62) reasons.push("\uc774\ubbf8 \ud070 \uc0c1\uc2b9 \ud6c4 \ud655\uc7a5 \ud655\uc778 \ubd80\uc871");

  if (item.stage === "EXHAUSTION" || risk >= 68 || (move >= 120 && expansion < 62) || finalScore < 38) {
    return {
      tone: "avoid",
      title: "\uc0ac\uc9c0 \ub9c8\uc138\uc694",
      body: `${reasons.slice(0, 3).join(", ")} \ub54c\ubb38\uc5d0 \ub9e4\uc218 \uc2e0\ud638\ub85c \ubcf4\uae30 \uc5b4\ub835\uc2b5\ub2c8\ub2e4.`,
    };
  }

  if (
    finalScore >= 70 &&
    risk <= 55 &&
    similarity >= 70 &&
    (precursor >= 72 || expansion >= 65) &&
    (volumeRatio >= 5 || preMarketVolume >= 1_000_000)
  ) {
    return {
      tone: "buy",
      title: "\ud22c\uc790\ud558\uc138\uc694",
      body: "\uae30\uc900 \uae09\ub4f1\uc8fc \uad6c\uc870\uc640 \uc720\uc0ac\ud558\uace0 \uac70\ub798\ub7c9 \uc2e0\ud638\uac00 \uac19\uc774 \ub4e4\uc5b4\uc654\uc2b5\ub2c8\ub2e4.",
    };
  }

  if (
    finalScore >= 58 &&
    risk <= 58 &&
    (similarity >= 70 || precursor >= 78) &&
    (volumeRatio >= 3 || preMarketVolume >= 500_000)
  ) {
    return {
      tone: "watch",
      title: "\uc18c\uc561 \ud22c\uc790 \ub610\ub294 \uad00\uc2ec",
      body: "\uc804\uc870\ub294 \uac15\ud558\uc9c0\ub9cc \ucd5c\uc885 \uc810\uc218\ub098 \ud655\uc7a5 \ud655\uc778\uc774 \uc544\uc9c1 \ubd80\uc871\ud569\ub2c8\ub2e4.",
    };
  }

  return {
    tone: "hold",
    title: "\ubcf4\ub958\ud558\uc138\uc694",
    body: "\uc2e0\ud638\uac00 \uc788\uc9c0\ub9cc \ub9e4\uc218 \uacb0\ub860\uc744 \ub0b4\ub9ac\uae30\uc5d0\ub294 \uc810\uc218 \uc870\ud569\uc774 \uc57d\ud569\ub2c8\ub2e4.",
  };
}

function renderCard(item, rank = null, searched = false) {
  const price = num(item.preMarketPrice) ?? num(item.price);
  const basisPrice = num(item.previousClose);
  const move = moveOf(item);
  const topMatch = item.patternMatches?.[0];
  const tech = item.technical || {};
  const verdict = tradeVerdict(item);
  const scanBadge = searched
    ? `<div class="scan-badge ${item.inScannerResults ? "good" : "bad"}">${item.inScannerResults ? label.included : label.excluded}</div>`
    : "";

  return `
    <article class="stock-card ${searched ? "searched" : ""}">
      <div class="card-top">
        <div>
          ${rank ? `<span class="rank-num">${rank}</span>` : ""}
          <span class="ticker">${item.symbol}</span>
          <div class="company">${item.name || item.symbol} ${item.exchange ? `- ${item.exchange}` : ""}</div>
          <div class="pre-after">${stageTitle(item.stage)} - ${(item.sourceTags || []).map(sourceKo).join(" - ")}</div>
          ${scanBadge}
        </div>
        <div>
          <div class="price">${won(price) || money(price)}</div>
          <div class="usd-price">${money(price)}${basisPrice === null ? "" : ` / \uae30\uc900 ${money(basisPrice)}`}</div>
          <div class="${move >= 0 ? "change-up" : "change-dn"}">${move >= 0 ? "\uc0c1\uc2b9" : "\ud558\ub77d"} ${pct(move)}</div>
        </div>
      </div>
      <div class="card-meta primary-meta">
        ${meta("\uc804\uc77c \uc885\uac00 \ub300\ube44", pct(item.preMarketChangePercent), num(item.preMarketChangePercent) >= 30)}
        ${meta("\uc7a5\uc804 \uac70\ub798\ub7c9", compact(item.preMarketVolume), num(item.preMarketVolume) >= 1_000_000)}
        ${meta("\ud3c9\uade0 \ub300\ube44 \uac70\ub798\ub7c9", item.volumeRatio == null ? "-" : `${Number(item.volumeRatio).toFixed(1)}x`, num(item.volumeRatio) >= 3)}
        ${meta("\uae30\uc900\uac00", basisPrice === null ? "\uc804\uc77c \uc885\uac00 \ubd80\uc871" : `\uc804\uc77c \uc885\uac00 ${money(basisPrice)}`)}
        ${meta("\uc2dc\uac00\ucd1d\uc561", compact(item.marketCap), num(item.marketCap) !== null && num(item.marketCap) <= 300_000_000)}
        ${meta("VWAP \uc704\uce58", vwapDisplay(tech), tech.vwapState === "above")}
        ${meta("\uac00\uc7a5 \uc720\uc0ac\ud55c \ud328\ud134", topMatch ? `${topMatch.symbol} ${topMatch.similarity}%` : "-")}
      </div>
      <div class="score-grid">
        ${scorePill("\uc804\uc870", item.surgePrecursorScore)}
        ${scorePill("\ud655\uc7a5", item.momentumExpansionScore)}
        ${scorePill("\uc720\uc0ac\ub3c4", item.patternSimilarityScore)}
        ${scorePill("\uc704\ud5d8", item.riskScore, true)}
        ${scorePill("\ucd5c\uc885", item.finalProbabilityScore)}
      </div>
      <div class="decision-card ${verdict.tone}">
        <div>
          <span>\ubaa8\ub378 \uacb0\ub860</span>
          <strong>${verdict.title}</strong>
        </div>
        <p>${verdict.body}</p>
      </div>
      <div class="reason-list">${(item.selectionReasons || []).slice(0, 8).map((reason) => `<span>${reasonKo(reason)}</span>`).join("")}</div>
      ${searched ? renderPatternComparison(item) : ""}
    </article>
  `;
}

function renderList(id, items, emptyText, expanded = false) {
  const el = $(id);
  el.className = "";
  el.innerHTML = items.length ? items.map((item, index) => renderCard(item, index + 1)).join("") : `<div class="empty-state">${emptyText}</div>`;
  el.style.display = expanded ? "" : "none";
}

function setStageVisibility(stage) {
  const pairs = [
    ["PRE-SURGE", "pre-surge-label", "pre-surge-list"],
    ["EARLY SURGE", "early-surge-label", "early-surge-list"],
    ["MOMENTUM EXPANSION", "momentum-label", "momentum-list"],
    ["EXHAUSTION", "exhaustion-label", "exhaustion-list"],
  ];
  for (const [key, labelId, listId] of pairs) {
    const visible = stage === key;
    $(labelId).style.display = visible ? "" : "none";
    $(listId).style.display = visible ? "" : "none";
  }
}

function renderScanner() {
  const pre = byStage("PRE-SURGE");
  const early = byStage("EARLY SURGE");
  const momentum = byStage("MOMENTUM EXPANSION");
  const exhaustion = byStage("EXHAUSTION");
  const shownCount = pre.length + early.length + momentum.length + exhaustion.length;
  const activeVerdict = verdictFilters.find((item) => item.key === state.activeVerdict);
  $("list-info").textContent = state.debug
    ? `${label.candidate} ${state.debug.candidateCount} - ${label.passed} ${state.items.length} - \ud45c\uc2dc ${shownCount} - ${new Date(state.debug.lastScanAt).toLocaleTimeString("ko-KR")}`
    : "\uc2dc\uc7a5 \ub370\uc774\ud130 \ubd84\uc11d \uc911";
  $("summary-strip").innerHTML = `
    <button class="stat-card stage-card ${state.activeStage === "PRE-SURGE" ? "active" : ""}" data-stage="PRE-SURGE"><div class="stat-label">${label.pre}</div><div class="stat-value good">${pre.length}</div><small>\ub204\ub974\uba74 \uc804\uccb4 \ud45c\uc2dc</small></button>
    <button class="stat-card stage-card ${state.activeStage === "EARLY SURGE" ? "active" : ""}" data-stage="EARLY SURGE"><div class="stat-label">${label.early}</div><div class="stat-value">${early.length}</div><small>\ub204\ub974\uba74 \uc804\uccb4 \ud45c\uc2dc</small></button>
    <button class="stat-card stage-card ${state.activeStage === "MOMENTUM EXPANSION" ? "active" : ""}" data-stage="MOMENTUM EXPANSION"><div class="stat-label">${label.momentum}</div><div class="stat-value">${momentum.length}</div><small>\ub204\ub974\uba74 \uc804\uccb4 \ud45c\uc2dc</small></button>
    <button class="stat-card stage-card ${state.activeStage === "EXHAUSTION" ? "active" : ""}" data-stage="EXHAUSTION"><div class="stat-label">${label.risk}</div><div class="stat-value bad">${exhaustion.length}</div><small>\ub204\ub974\uba74 \uc804\uccb4 \ud45c\uc2dc</small></button>
  `;
  $("decision-filter").innerHTML = `
    <div class="decision-filter-head">\ubaa8\ub378 \uacb0\ub860 \uce74\ud14c\uace0\ub9ac</div>
    <div class="decision-filter-row">
      ${verdictFilters.map((filter) => `
        <button class="decision-filter-btn ${state.activeVerdict === filter.key ? "active" : ""} ${filter.key}" type="button" data-verdict="${filter.key}">
          <span>${filter.title}</span>
          <b>${verdictCount(filter.key)}</b>
        </button>
      `).join("")}
    </div>
  `;
  const emptySuffix = activeVerdict && activeVerdict.key !== "all" ? ` - ${activeVerdict.title} \uce74\ud14c\uace0\ub9ac\uc5d0 \ud574\ub2f9 \uc5c6\uc74c` : "";
  renderList("pre-surge-list", pre, `${label.noPre}${emptySuffix}`, state.activeStage === "PRE-SURGE");
  renderList("early-surge-list", early, `${label.noEarly}${emptySuffix}`, state.activeStage === "EARLY SURGE");
  renderList("momentum-list", momentum, `${label.noMomentum}${emptySuffix}`, state.activeStage === "MOMENTUM EXPANSION");
  renderList("exhaustion-list", exhaustion, `${label.noRisk}${emptySuffix}`, state.activeStage === "EXHAUSTION");
  setStageVisibility(state.activeStage);
}

function renderDebug() {
  if (!state.debug) return;
  const watched = Object.entries(state.debug.watchedSymbols || {})
    .map(([symbol, info]) => `
      <tr><td><strong>${symbol}</strong></td><td>${info.presentInRawCandidates ? "\uc6d0\uc2dc \ud6c4\ubcf4 \ud3ec\ud568" : "\uc6d0\uc2dc \ud6c4\ubcf4 \ubbf8\ud3ec\ud568"}</td><td>${info.included ? "\ud3ec\ud568" : "\uc81c\uc678"}</td><td>${stageTitle(info.stage)}</td><td>${pct(info.preMarketChangePercent)}</td><td>${compact(info.preMarketVolume)}</td><td>${info.finalProbabilityScore ?? "-"}</td><td>${info.patternSimilarityScore ?? "-"}</td><td>${info.excludedReason || "-"}</td></tr>
    `)
    .join("");
  const sources = (state.debug.sourceStatuses || [])
    .map((source) => `<div class="stat-card"><div class="stat-label">${sourceNameKo(source.name)}</div><div class="stat-value ${source.ok ? "good" : "bad"}">${source.ok ? "\uc131\uacf5" : "\uc2e4\ud328"}</div><div class="debug-small">${source.count}\uac1c - ${source.ms}ms ${source.rateLimited ? "- \uc81c\ud55c \uac10\uc9c0" : ""}</div>${source.error ? `<div class="debug-small bad">${source.error}</div>` : ""}</div>`)
    .join("");
  $("debug-panel").innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">\ub9c8\uc9c0\ub9c9 \uc2a4\uce94</div><div class="stat-value">${new Date(state.debug.lastScanAt).toLocaleTimeString("ko-KR")}</div></div>
      <div class="stat-card"><div class="stat-label">\ud6c4\ubcf4\uad70 \uc218</div><div class="stat-value">${state.debug.candidateCount}</div></div>
      <div class="stat-card"><div class="stat-label">API \uc81c\ud55c</div><div class="stat-value ${state.debug.rateLimited ? "bad" : "good"}">${state.debug.rateLimited ? "\uac10\uc9c0" : "\uc5c6\uc74c"}</div></div>
      <div class="stat-card"><div class="stat-label">\ucd94\uac00 \uc870\ud68c</div><div class="stat-value">${state.debug.enrichment?.succeeded ?? 0}</div></div>
    </div>
    <div class="section-label">\ub370\uc774\ud130 \uc18c\uc2a4</div><div class="stats-grid">${sources}</div>
    <div class="section-label">\uc9d1\uc911 \uac10\uc2dc \ud2f0\ucee4</div>
    <div class="table-wrap"><table class="recommendation-table"><thead><tr><th>\ud2f0\ucee4</th><th>\uc6d0\uc2dc \ud6c4\ubcf4</th><th>\uacb0\uacfc</th><th>\ub2e8\uacc4</th><th>\uc7a5\uc804%</th><th>\uc7a5\uc804 \uac70\ub798\ub7c9</th><th>\ucd5c\uc885</th><th>\uc720\uc0ac\ub3c4</th><th>\uc0ac\uc720</th></tr></thead><tbody>${watched}</tbody></table></div>
    <div class="section-label">\uc6d0\uc2dc \ub370\uc774\ud130</div><div class="data-view"><pre>${JSON.stringify(state.debug, null, 2)}</pre></div>
  `;
}

async function refreshScanner(force = false) {
  $("refresh-btn").disabled = true;
  $("pre-surge-list").className = "loading-card";
  $("pre-surge-list").innerHTML = `<div class="spinner"></div>${label.searching}`;
  try {
    const data = await getJson(`${api.scanner}${force ? "?force=1" : ""}`);
    state.items = data.items || [];
    state.debug = data.debug;
    console.group("stock candidate debug");
    console.log("candidateCount", data.debug?.candidateCount);
    console.log("symbolsIncluded", data.debug?.symbolsIncluded);
    console.log("excludedReason", data.debug?.excludedReason);
    console.log("watchedSymbols", data.debug?.watchedSymbols);
    console.groupEnd();
    renderScanner();
    renderDebug();
  } catch (error) {
    $("pre-surge-list").className = "";
    $("pre-surge-list").innerHTML = `<div class="error-card"><strong>${label.scanFailed}</strong><small>${error.message}</small></div>`;
  } finally {
    $("refresh-btn").disabled = false;
  }
}

async function searchSymbol() {
  const symbol = cleanSymbol($("ticker-input").value);
  if (!symbol) return;
  $("ticker-input").value = symbol;
  switchTab("search");
  $("search-result").className = "loading-card";
  $("search-result").innerHTML = `<div class="spinner"></div>${symbol} \ubd84\uc11d \uc911...`;
  try {
    const item = await getJson(api.quote(symbol));
    $("search-result").className = "";
    $("search-result").innerHTML = `<div class="section-label">${label.directSearch}</div>${renderCard(item, null, true)}`;
  } catch (error) {
    $("search-result").className = "";
    $("search-result").innerHTML = `<div class="error-card"><strong>${symbol} ${label.searchFailed}</strong><small>${error.message}</small></div>`;
  }
}

function renderBacktestTable(data) {
  const rows = (data.rows || [])
    .map((row) => row.error
      ? `<tr><td><strong>${row.symbol}</strong></td><td colspan="8">${row.error}</td></tr>`
      : `<tr><td><strong>${row.symbol}</strong></td><td>${row.recommendationDate}</td><td>${money(row.recommendationPrice)}</td><td>${compact(row.volumeAtRecommendation)}</td><td>${pct(row.maxGain1d)}</td><td>${pct(row.maxGain3d)}</td><td>${pct(row.maxGain5d)}</td><td>${row.patternSimilarity}%</td><td>${row.actualSurge ? "\uae09\ub4f1 \uc131\uacf5" : row.success ? "\uc131\uacf5" : "\uc2e4\ud328"}</td></tr>`)
    .join("");
  $("backtest-result").className = "";
  $("backtest-result").innerHTML = `
    <div class="section-label">\ubc31\ud14c\uc2a4\ud2b8 ${data.date}</div>
    <div class="table-wrap"><table class="recommendation-table"><thead><tr><th>\ud2f0\ucee4</th><th>\ucd94\ucc9c\uc77c</th><th>\ucd94\ucc9c\uac00</th><th>\ub2f9\uc77c \uac70\ub798\ub7c9</th><th>1\uc77c \ucd5c\ub300</th><th>3\uc77c \ucd5c\ub300</th><th>5\uc77c \ucd5c\ub300</th><th>\ud328\ud134 \uc720\uc0ac\ub3c4</th><th>\uacb0\uacfc</th></tr></thead><tbody>${rows}</tbody></table></div>
  `;
}

async function runBacktest() {
  const date = $("backtest-date").value;
  $("backtest-result").className = "loading-card";
  $("backtest-result").innerHTML = `<div class="spinner"></div>\ubc31\ud14c\uc2a4\ud2b8 \uacc4\uc0b0 \uc911...`;
  try {
    renderBacktestTable(await getJson(api.backtest(date)));
  } catch (error) {
    $("backtest-result").className = "";
    $("backtest-result").innerHTML = `<div class="error-card"><strong>${label.backtestFailed}</strong><small>${error.message}</small></div>`;
  }
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $("scanner-panel").style.display = tab === "scanner" ? "" : "none";
  $("search-panel").style.display = tab === "search" ? "" : "none";
  $("backtest-panel").style.display = tab === "backtest" ? "" : "none";
  $("debug-section").style.display = tab === "debug" ? "" : "none";
}

function setActiveStage(stage) {
  state.activeStage = stage;
  renderScanner();
  const target = {
    "PRE-SURGE": "pre-surge-list",
    "EARLY SURGE": "early-surge-list",
    "MOMENTUM EXPANSION": "momentum-list",
    EXHAUSTION: "exhaustion-list",
  }[stage];
  if (target) $(target).scrollIntoView({ behavior: "smooth", block: "start" });
}

function setActiveVerdict(verdict) {
  state.activeVerdict = verdict;
  renderScanner();
}

async function loadExchangeRate() {
  try {
    const data = await getJson(api.exchange);
    state.exchangeRate = data.rate || data.usdKrw || data.exchangeRate;
    $("exchange-rate").textContent = state.exchangeRate ? `USD/KRW ${Number(state.exchangeRate).toLocaleString("ko-KR")}` : "\ud658\uc728 \uc5c6\uc74c";
  } catch {
    $("exchange-rate").textContent = "\ud658\uc728 \uc870\ud68c \uc2e4\ud328";
  }
}

function bindEvents() {
  $("refresh-btn").addEventListener("click", () => refreshScanner(true));
  $("search-btn").addEventListener("click", searchSymbol);
  $("backtest-btn").addEventListener("click", runBacktest);
  $("summary-strip").addEventListener("click", (event) => {
    const card = event.target.closest("[data-stage]");
    if (card) setActiveStage(card.dataset.stage);
  });
  $("scanner-panel").addEventListener("click", (event) => {
    const verdict = event.target.closest("[data-verdict]");
    if (verdict) {
      setActiveVerdict(verdict.dataset.verdict);
      return;
    }
    const more = event.target.closest("[data-stage-more]");
    if (!more) return;
    const map = {
      "pre-surge-list": "PRE-SURGE",
      "early-surge-list": "EARLY SURGE",
      "momentum-list": "MOMENTUM EXPANSION",
      "exhaustion-list": "EXHAUSTION",
    };
    setActiveStage(map[more.dataset.stageMore]);
  });
  $("ticker-input").addEventListener("keydown", (event) => { if (event.key === "Enter") searchSymbol(); });
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $("backtest-date").value = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

bindEvents();
loadExchangeRate().then(() => refreshScanner(false));
