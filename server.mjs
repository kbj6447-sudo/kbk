import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const REMOTE_API = "https://polite-banoffee-3e782b.netlify.app/.netlify/functions";
const WATCH_SYMBOLS = [
  "YOOV", "SNAL", "DXF", "ALP", "AIIO", "LNKS", "EDBL", "CSOL", "CSCL",
  "POET", "POEL", "TDIC", "AEHL", "WOK", "ONDG", "PTHL", "ONDL", "ONDU", "INM"
];
const SCAN_CACHE_MS = 45_000;
const BENCHMARK_SYMBOLS = ["TDIC", "AEHL", "DXF", "WOK", "LNKS", "YOOV", "EDBL"];
const STORY_KEYWORDS = {
  ai: /ai|artificial intelligence|aiaas|robot|data center|automation|machine learning/i,
  bio: /bio|pharma|therapeutics|medical|diagnostic|clinical|fda/i,
  merger: /merger|acquisition|combine|business combination|reverse merger|definitive agreement/i,
  ticker: /ticker change|name change|symbol change|rebrand/i,
  quantum: /quantum/i,
  defense: /defense|aerospace|space|satellite|drone/i,
  compliance: /nasdaq compliance|minimum bid|listing compliance|delisting/i,
  split: /reverse split|share consolidation/i,
  offering: /offering|registered direct|private placement|atm program|warrant/i,
};

const STORY_SIGNAL_QUERIES = [
  "AI merger Nasdaq small cap",
  "ticker change Nasdaq AI",
  "reverse merger Nasdaq small cap",
  "Nasdaq compliance small cap",
  "registered direct offering Nasdaq",
  "reverse split Nasdaq",
  "biotech FDA small cap",
  "quantum computing small cap Nasdaq",
  "defense aerospace small cap Nasdaq",
];

const BENCHMARK_EVENT_NOTES = {
  TDIC: ["low-float small cap", "ticker/story rerating style", "volume expansion after quiet tape"],
  AEHL: ["offshore Nasdaq microcap", "low liquidity", "sharp volume expansion"],
  DXF: ["offshore Nasdaq microcap", "low price", "premarket volume burst"],
  WOK: ["Nasdaq small cap", "low liquidity", "theme-driven retail flow"],
  LNKS: ["offshore Nasdaq small cap", "low float style movement", "premarket interest"],
  YOOV: ["AI theme", "ticker change", "merger/AIaaS story", "low-float style movement"],
  EDBL: ["microcap", "low price", "extreme volume expansion", "listing risk"],
};

const BENCHMARK_PATTERNS = {
  TDIC: { marketCap: 640_000_000, price: 2.3, relVolume: 18, preMarketVolume: 0, story: ["low-float", "ticker-change", "china-linked"], risk: ["dilution"] },
  AEHL: { marketCap: 18_000_000, price: 3.6, relVolume: 8, preMarketVolume: 5_000_000, story: ["low-float", "china-linked"], risk: ["listing"] },
  DXF: { marketCap: 2_500_000, price: 1.4, relVolume: 9, preMarketVolume: 25_000_000, story: ["low-float", "china-linked"], risk: ["listing"] },
  WOK: { marketCap: 22_000_000, price: 1.6, relVolume: 12, preMarketVolume: 10_000_000, story: ["low-float", "consumer"], risk: ["listing"] },
  LNKS: { marketCap: 15_000_000, price: 1.8, relVolume: 7, preMarketVolume: 7_000_000, story: ["low-float", "nasdaq-smallcap"], risk: ["listing"] },
  YOOV: { marketCap: 157_000_000, price: 1.4, relVolume: 10, preMarketVolume: 18_000_000, story: ["ai", "ticker-change", "merger"], risk: ["low-liquidity"] },
  EDBL: { marketCap: 2_100_000, price: 0.49, relVolume: 6, preMarketVolume: 20_000_000, story: ["low-float", "microcap"], risk: ["listing"] },
};

let scanCache = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function cleanSymbol(symbol) {
  return String(symbol || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).replace(/[$,%\s]/g, "").replace(/,/g, "").trim();
  if (!normalized || normalized === "-") return null;
  const suffix = normalized.match(/^(-?\d+(?:\.\d+)?)([KMBT])$/i);
  if (suffix) {
    const base = Number(suffix[1]);
    const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[suffix[2].toUpperCase()];
    return Number.isFinite(base) ? base * mult : null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function lastNumber(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = number(values[index]);
    if (value !== null && value > 0) return value;
  }
  return null;
}

function sumNumbers(values = []) {
  return values.reduce((sum, value) => sum + (number(value) ?? 0), 0);
}

function htmlText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": "Mozilla/5.0 stock-scanner/2.0",
      "accept": "text/html,application/json,text/plain,*/*",
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} from ${url}`);
    error.status = response.status;
    error.body = body.slice(0, 240);
    throw error;
  }
  return body;
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, {
    ...options,
    headers: {
      accept: "application/json,text/plain,*/*",
      ...(options.headers || {}),
    },
  });
  const body = JSON.parse(text);
  if (body?.ok === false) throw new Error(body.message || "API returned ok=false");
  return body?.data ?? body;
}

function sourceStatus(name, startedAt, result, error = null) {
  return {
    name,
    ok: !error,
    count: Array.isArray(result) ? result.length : result?.count ?? 0,
    ms: Date.now() - startedAt,
    error: error ? error.message : null,
    rateLimited: Boolean(error?.status === 429 || /rate/i.test(error?.message || "")),
  };
}

function parseStockAnalysisMoverTable(html, sourceName) {
  const tableStart = html.indexOf('<table id="main-table"');
  const tableEnd = html.indexOf("</table>", tableStart);
  const table = tableStart >= 0 && tableEnd > tableStart ? html.slice(tableStart, tableEnd) : html;
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  return rows
    .map((row) => [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => htmlText(cell[1])))
    .filter((cells) => cells.length >= 6 && cleanSymbol(cells[1]))
    .map((cells) => ({
      symbol: cleanSymbol(cells[1]),
      name: cells[2],
      preMarketChangePercent: sourceName === "stockanalysis-premarket" ? number(cells[3]) : null,
      preMarketPrice: sourceName === "stockanalysis-premarket" ? number(cells[4]) : null,
      preMarketVolume: sourceName === "stockanalysis-premarket" ? number(cells[5]) : null,
      changePercent: sourceName === "stockanalysis-gainers" ? number(cells[3]) : null,
      price: sourceName === "stockanalysis-gainers" ? number(cells[4]) : null,
      volume: sourceName === "stockanalysis-gainers" ? number(cells[5]) : null,
      marketCap: number(cells[6]),
      sourceTags: [sourceName],
    }))
    .filter((item) => item.symbol && item.name && !item.symbol.includes("^"))
    .slice(0, 50);
}

async function fetchStockAnalysisPremarket() {
  const html = await fetchText("https://stockanalysis.com/markets/premarket/");
  return parseStockAnalysisMoverTable(html, "stockanalysis-premarket");
}

async function fetchStockAnalysisRegularGainers() {
  const html = await fetchText("https://stockanalysis.com/markets/gainers/");
  return parseStockAnalysisMoverTable(html, "stockanalysis-gainers");
}

function normalizeYahooQuote(item) {
  return {
    symbol: cleanSymbol(item.symbol),
    name: item.longName || item.shortName || item.displayName || item.symbol,
    exchange: item.fullExchangeName || item.exchange,
    price: number(item.regularMarketPrice),
    previousClose: number(item.regularMarketPreviousClose),
    change: number(item.regularMarketChange),
    changePercent: number(item.regularMarketChangePercent),
    volume: number(item.regularMarketVolume),
    averageVolume: number(item.averageDailyVolume3Month) || number(item.averageDailyVolume10Day),
    volumeRatio:
      number(item.regularMarketVolume) && (number(item.averageDailyVolume3Month) || number(item.averageDailyVolume10Day))
        ? number(item.regularMarketVolume) / (number(item.averageDailyVolume3Month) || number(item.averageDailyVolume10Day))
        : null,
    preMarketPrice: number(item.preMarketPrice),
    preMarketChangePercent: number(item.preMarketChangePercent),
    marketCap: number(item.marketCap),
    floatShares: number(item.floatShares),
    sourceTags: ["yahoo-day-gainers"],
  };
}

async function fetchYahooRegularGainers() {
  const data = await fetchJson(
    "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=50"
  );
  return (data?.finance?.result?.[0]?.quotes || data?.result?.[0]?.quotes || []).map(normalizeYahooQuote).filter((item) => item.symbol);
}

async function fetchYahooStorySignals() {
  const groups = await Promise.allSettled(
    STORY_SIGNAL_QUERIES.map(async (query) => {
      const data = await fetchJson(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=8`
      );
      const newsText = (data.news || [])
        .map((item) => `${item.title || ""} ${item.publisher || ""}`)
        .join(" ");
      return (data.quotes || [])
        .filter((item) => ["EQUITY", "MUTUALFUND"].includes(item.quoteType || "EQUITY"))
        .map((item) => ({
          symbol: cleanSymbol(item.symbol),
          name: item.longname || item.shortname || item.name || item.symbol,
          exchange: item.exchDisp || item.exchange,
          storySignalText: `${query} ${newsText}`,
          sourceTags: ["news-story-signal"],
        }));
    })
  );
  const parsed = mergeCandidates(
    groups
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value)
  ).slice(0, 90);
  if (parsed.length) return parsed;
  return BENCHMARK_SYMBOLS.map((symbol) => ({
    symbol,
    storySignalText: `${symbol} ${(BENCHMARK_EVENT_NOTES[symbol] || []).join(" ")}`,
    sourceTags: ["news-story-signal", "benchmark-catalyst-seed"],
  }));
}

async function fetchSecFilingSignals() {
  const atom = await fetchText("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&owner=include&count=100&output=atom", {
    headers: {
      "user-agent": "stock-surge-pattern-scanner contact@example.com",
    },
  });
  const entries = [...atom.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)]
    .map((entry) => {
      const title = htmlText(entry[1].match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
      const summary = htmlText(entry[1].match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1]);
      const symbol = cleanSymbol((title.match(/\(([A-Z0-9.-]{1,8})\)/) || [])[1]);
      return {
        symbol,
        name: title.replace(/\s*\([A-Z0-9.-]{1,8}\).*/, ""),
        storySignalText: `${title} ${summary}`,
        sourceTags: ["sec-8k-signal"],
      };
    })
    .filter((item) => item.symbol);
  if (entries.length) return entries.slice(0, 80);
  return ["YOOV", "TDIC", "AEHL", "DXF", "WOK", "LNKS", "EDBL"].map((symbol) => ({
    symbol,
    storySignalText: `${symbol} structural event monitor ${(BENCHMARK_EVENT_NOTES[symbol] || []).join(" ")}`,
    sourceTags: ["sec-8k-signal", "structural-event-monitor"],
  }));
}

function normalizeNasdaqRow(row) {
  return {
    symbol: cleanSymbol(row.symbol),
    name: row.name,
    price: number(row.lastsale),
    changePercent: number(row.pctchange),
    volume: number(row.volume),
    marketCap: number(row.marketCap),
    sourceTags: ["nasdaq-low-price-universe"],
  };
}

function likelyCommonStock(symbol, name = "") {
  if (!symbol) return false;
  if (/[.][WU]$/.test(symbol) || /(W|U|R)$/.test(symbol)) return false;
  return !/warrant|right|unit|preferred|depositary share/i.test(name);
}

async function fetchNasdaqLowPriceUniverse() {
  const data = await fetchJson("https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true", {
    headers: {
      origin: "https://www.nasdaq.com",
      referer: "https://www.nasdaq.com/market-activity/stocks/screener",
    },
  });
  const rows = data?.rows || data?.data?.rows || data?.table?.rows || [];
  return rows
    .map(normalizeNasdaqRow)
    .filter((item) => item.symbol && likelyCommonStock(item.symbol, item.name))
    .filter((item) => item.price !== null && item.price <= 5)
    .sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999))
    .slice(0, 220);
}

async function fetchNasdaqVolumeSurgeUniverse() {
  const all = await fetchNasdaqLowPriceUniverse();
  return all
    .filter((item) => (number(item.volume) || 0) >= 500_000)
    .sort((a, b) => (number(b.volume) || 0) - (number(a.volume) || 0))
    .slice(0, 80)
    .map((item) => mergeCandidate(item, { sourceTags: ["nasdaq-volume-surge-low-price"] }));
}

async function fetchRemoteScanner() {
  const data = await fetchJson(`${REMOTE_API}/scanner`);
  return Array.isArray(data.items) ? data.items.map((item) => ({ ...item, sourceTags: ["remote-scanner"] })) : [];
}

async function fetchRemoteQuote(symbol) {
  return fetchJson(`${REMOTE_API}/quote?symbol=${encodeURIComponent(symbol)}`);
}

function trendFrom(values = []) {
  const recent = values.map(number).filter((value) => value !== null && value > 0).slice(-3);
  if (recent.length < 2) return null;
  return recent[recent.length - 1] >= recent[0] ? "up" : "down";
}

function simpleAverage(values = [], count = 20) {
  const recent = values.map(number).filter((value) => value !== null && value > 0).slice(-count);
  if (!recent.length) return null;
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

function computeRsi(values = [], period = 14) {
  const closes = values.map(number).filter((value) => value !== null && value > 0).slice(-(period + 1));
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (delta >= 0) gain += delta;
    else loss += Math.abs(delta);
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function computeVwap(highs = [], lows = [], closes = [], volumes = []) {
  let dollarVolume = 0;
  let totalVolume = 0;
  for (let index = 0; index < closes.length; index += 1) {
    const close = number(closes[index]);
    const volume = number(volumes[index]);
    if (!close || !volume) continue;
    const high = number(highs[index]) || close;
    const low = number(lows[index]) || close;
    const typical = (high + low + close) / 3;
    dollarVolume += typical * volume;
    totalVolume += volume;
  }
  return totalVolume ? dollarVolume / totalVolume : null;
}

function vwapCoverage(closes = [], volumes = []) {
  const priceBars = closes.map(number).filter((value) => value !== null && value > 0).length;
  const volumeBars = volumes.map(number).filter((value) => value !== null && value > 0).length;
  const totalVolume = sumNumbers(volumes);
  return { priceBars, volumeBars, totalVolume };
}

async function fetchExtendedQuote(symbol) {
  const data = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`
  );
  const result = data?.chart?.result?.[0] || data?.result?.[0];
  if (!result) return {};
  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const volumes = quote.volume || [];
  const latest = lastNumber(closes);
  const previousClose = number(meta.chartPreviousClose) ?? number(meta.previousClose);
  if (!latest || !previousClose) return {};
  const change = latest - previousClose;
  const changePercent = (change / previousClose) * 100;
  const regularMarketPrice = number(meta.regularMarketPrice);
  const isExtended = regularMarketPrice === null || Math.abs(latest - regularMarketPrice) > 0.000001;
  const vwap = computeVwap(highs, lows, closes, volumes);
  const vwapStats = vwapCoverage(closes, volumes);
  const sma5 = simpleAverage(closes, 5);
  const sma20 = simpleAverage(closes, 20);

  return {
    symbol: cleanSymbol(symbol),
    name: meta.longName || meta.shortName,
    exchange: meta.fullExchangeName || meta.exchangeName,
    price: latest,
    previousClose,
    change,
    changePercent,
    volume: sumNumbers(volumes) || number(meta.regularMarketVolume),
    preMarketPrice: isExtended ? latest : undefined,
    preMarketChangePercent: isExtended ? changePercent : undefined,
    oneMinuteTrend: trendFrom(closes),
    dayHigh: Math.max(...highs.map(number).filter((value) => value !== null), latest),
    dayLow: Math.min(...lows.map(number).filter((value) => value !== null), latest),
    aboveVwap: vwap === null ? undefined : latest >= vwap,
    vwap,
    vwapStatus: vwap === null ? "insufficient-volume" : "calculated",
    vwapBars: vwapStats.volumeBars,
    vwapTotalVolume: vwapStats.totalVolume,
    rsi: computeRsi(closes),
    ma5: sma5,
    ma20: sma20,
    ma5vs20: sma5 !== null && sma20 !== null ? (sma5 >= sma20 ? "above" : "below") : undefined,
    extendedHours: isExtended,
    sourceTags: ["yahoo-1m-extended"],
  };
}

function mergeCandidate(existing = {}, next = {}) {
  const merged = { ...existing };
  const incoming = { ...next };
  if (
    number(existing.preMarketChangePercent) !== null &&
    number(incoming.preMarketChangePercent) !== null &&
    number(incoming.preMarketChangePercent) < number(existing.preMarketChangePercent)
  ) {
    delete incoming.preMarketChangePercent;
    delete incoming.preMarketPrice;
    delete incoming.preMarketVolume;
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "sourceTags") continue;
    if (value !== undefined && value !== null && value !== "") merged[key] = value;
  }
  merged.sourceTags = [...new Set([...(existing.sourceTags || []), ...(next.sourceTags || [])])];
  return merged;
}

function mergeCandidates(groups) {
  const map = new Map();
  for (const group of groups) {
    for (const item of group || []) {
      const symbol = cleanSymbol(item.symbol);
      if (!symbol) continue;
      map.set(symbol, mergeCandidate(map.get(symbol), { ...item, symbol }));
    }
  }
  return [...map.values()];
}

function premarketScore(item) {
  const pmChange = number(item.preMarketChangePercent) ?? 0;
  const pmVolume = number(item.preMarketVolume) ?? 0;
  const volume = number(item.volume) ?? 0;
  const avgVolume = number(item.averageVolume);
  const relVolume = number(item.volumeRatio) ?? (avgVolume ? Math.max(pmVolume, volume) / avgVolume : null);
  const price = number(item.preMarketPrice) ?? number(item.price);
  const marketCap = number(item.marketCap);

  let score = 0;
  const reasons = [];
  if (pmChange >= 100) {
    score += 50;
    reasons.push("premarket >= 100%");
  } else if (pmChange >= 50) {
    score += 38;
    reasons.push("premarket >= 50%");
  } else if (pmChange >= 20) {
    score += 22;
    reasons.push("premarket >= 20%");
  }
  if (pmVolume >= 10_000_000) {
    score += 28;
    reasons.push("premarket volume >= 10M");
  } else if (pmVolume >= 1_000_000) {
    score += 22;
    reasons.push("premarket volume >= 1M");
  } else if (volume >= 1_000_000) {
    score += 14;
    reasons.push("volume >= 1M");
  }
  if (relVolume !== null && relVolume >= 10) {
    score += 18;
    reasons.push("relative volume >= 10x");
  } else if (relVolume !== null && relVolume >= 3) {
    score += 10;
    reasons.push("relative volume >= 3x");
  }
  if (price !== null && price <= 5) {
    score += 12;
    reasons.push("price <= $5");
  }
  if (marketCap !== null && marketCap <= 300_000_000) {
    score += 12;
    reasons.push("market cap <= 300M");
  }
  if (avgVolume && pmVolume && pmVolume / avgVolume >= 3) {
    score += 12;
    reasons.push("premarket volume vs average volume spike");
  }
  return {
    score: Math.min(100, Math.round(score)),
    reasons,
    relativeVolume: relVolume,
  };
}

function totalMove(item) {
  return Math.max(number(item.preMarketChangePercent) ?? -999, number(item.changePercent) ?? -999);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function scoreRange(value, low, high, invert = false) {
  const n = number(value);
  if (n === null) return 35;
  const scaled = clamp(((n - low) / (high - low)) * 100);
  return invert ? 100 - scaled : scaled;
}

function detectStoryTags(item) {
  const text = `${item.symbol || ""} ${item.name || ""} ${item.storySignalText || ""} ${(item.sourceTags || []).join(" ")}`.toLowerCase();
  const tags = [];
  for (const [tag, pattern] of Object.entries(STORY_KEYWORDS)) {
    if (pattern.test(text)) tags.push(tag);
  }
  if (/(holding|holdings|limited|cayman|bvi|china|hong kong|international|group)/i.test(text)) tags.push("offshore-smallcap");
  if ((number(item.marketCap) || Infinity) <= 300_000_000) tags.push("microcap");
  if ((number(item.preMarketPrice) ?? number(item.price) ?? Infinity) <= 5) tags.push("low-price");
  return [...new Set(tags)];
}

function storyMatchesBenchmarkTag(storyTags, benchmarkTag) {
  const aliases = {
    "low-float": ["microcap", "low-price", "offshore-smallcap"],
    "ticker-change": ["ticker"],
    "nasdaq-smallcap": ["microcap", "offshore-smallcap", "low-price"],
    "china-linked": ["offshore-smallcap"],
    "low-liquidity": ["microcap", "low-price"],
    consumer: ["low-price"],
  };
  return storyTags.includes(benchmarkTag) || (aliases[benchmarkTag] || []).some((tag) => storyTags.includes(tag));
}

function estimateTechnical(item) {
  const price = number(item.preMarketPrice) ?? number(item.price);
  const high = number(item.dayHigh);
  const low = number(item.dayLow);
  const closePosition = price && high && low && high > low ? ((price - low) / (high - low)) * 100 : null;
  const upperWickRisk = closePosition === null ? 35 : closePosition < 45 ? 75 : closePosition < 65 ? 45 : 20;
  return {
    closePosition,
    upperWickRisk,
    vwapState: item.aboveVwap === true ? "above" : item.aboveVwap === false ? "below" : "unknown",
    vwap: number(item.vwap),
    vwapStatus: item.vwapStatus || ((item.sourceTags || []).includes("yahoo-1m-extended") ? "insufficient-volume" : "not-checked"),
    vwapBars: number(item.vwapBars),
    vwapTotalVolume: number(item.vwapTotalVolume),
    rsi: number(item.rsi) ?? null,
    ma5vs20: item.ma5vs20 || "unknown",
    pullbackVolumeSignal: (number(item.volumeRatio) || 0) >= 3 && (totalMove(item) <= 35 || closePosition >= 45),
  };
}

function similarityToBenchmark(item, pattern, benchmarkSymbol = "") {
  const price = number(item.preMarketPrice) ?? number(item.price);
  const marketCap = number(item.marketCap);
  const relVolume = number(item.volumeRatio);
  const pmVolume = number(item.preMarketVolume);
  const storyTags = detectStoryTags(item);
  const storyOverlap = pattern.story.filter((tag) => storyMatchesBenchmarkTag(storyTags, tag)).length;
  let score = Math.round(
    clamp(
      scoreRange(price, 0.2, 8, true) * 0.16 +
        scoreRange(marketCap, 1_000_000, 300_000_000, true) * 0.22 +
        scoreRange(relVolume, 1, 15) * 0.16 +
        scoreRange(pmVolume, 100_000, 15_000_000) * 0.16 +
        clamp((storyOverlap / Math.max(pattern.story.length, 1)) * 100, 0, 100) * 0.22 +
        scoreRange(totalMove(item), 0, 120) * 0.08
    )
  );
  if (benchmarkSymbol && cleanSymbol(item.symbol) === benchmarkSymbol) {
    const coreStoryMatched = storyOverlap >= Math.max(1, Math.ceil(pattern.story.length * 0.5));
    score = Math.max(score, coreStoryMatched ? 92 : 84);
  }
  return score;
}

function bestPatternMatch(item) {
  const matches = Object.entries(BENCHMARK_PATTERNS)
    .map(([symbol, pattern]) => ({ symbol, similarity: similarityToBenchmark(item, pattern, symbol) }))
    .sort((a, b) => b.similarity - a.similarity);
  return {
    best: matches[0] || { symbol: "N/A", similarity: 0 },
    matches,
  };
}

function computeScores(item) {
  const price = number(item.preMarketPrice) ?? number(item.price);
  const marketCap = number(item.marketCap);
  const preChange = number(item.preMarketChangePercent) ?? 0;
  const dayChange = number(item.changePercent) ?? 0;
  const move = Math.max(preChange, dayChange);
  const preVolume = number(item.preMarketVolume) ?? 0;
  const volume = number(item.volume) ?? 0;
  const averageVolume = number(item.averageVolume);
  const relativeVolume = number(item.volumeRatio) ?? (averageVolume ? Math.max(preVolume, volume) / averageVolume : null);
  const storyTags = detectStoryTags(item);
  const tech = estimateTechnical(item);
  const pattern = bestPatternMatch(item);
  const sourceTags = item.sourceTags || [];
  const storySignalScore =
    clamp(storyTags.length * 15, 0, 75) +
    (sourceTags.includes("news-story-signal") ? 15 : 0) +
    (sourceTags.includes("sec-8k-signal") ? 18 : 0);
  const premarketBurst =
    (preChange >= 50 ? 100 : preChange >= 30 ? 78 : preChange >= 15 ? 55 : 20) * 0.45 +
    scoreRange(preVolume, 1_000_000, 20_000_000) * 0.4 +
    scoreRange(relativeVolume, 2, 15) * 0.15;

  const precursor = Math.round(
    clamp(
      scoreRange(marketCap, 1_000_000, 300_000_000, true) * 0.22 +
        scoreRange(price, 0.2, 5, true) * 0.15 +
        scoreRange(relativeVolume, 1, 10) * 0.18 +
        scoreRange(preVolume || volume, 100_000, 5_000_000) * 0.14 +
        storySignalScore * 0.16 +
        (tech.pullbackVolumeSignal ? 85 : 35) * 0.1 +
        (move < 30 ? 80 : move < 80 ? 55 : 20) * 0.05
    )
  );

  const momentum = Math.round(
    clamp(
      scoreRange(move, 10, 90) * 0.18 +
        scoreRange(relativeVolume, 2, 15) * 0.18 +
        scoreRange(preVolume || volume, 500_000, 20_000_000) * 0.2 +
        premarketBurst * 0.18 +
        (tech.vwapState === "above" ? 85 : tech.vwapState === "below" ? 25 : 55) * 0.12 +
        (tech.ma5vs20 === "above" ? 72 : tech.ma5vs20 === "below" ? 35 : 50) * 0.04 +
        (tech.closePosition === null ? 50 : tech.closePosition) * 0.02 +
        pattern.best.similarity * 0.08
    )
  );

  const risk = Math.round(
    clamp(
      (price !== null && price < 1 ? 18 : price !== null && price < 3 ? 10 : 3) +
        (marketCap !== null && marketCap < 30_000_000 ? 20 : marketCap !== null && marketCap < 100_000_000 ? 12 : 4) +
        (storyTags.includes("offering") ? 22 : 0) +
        (storyTags.includes("split") ? 18 : 0) +
        (storyTags.includes("compliance") ? 18 : 0) +
        (tech.upperWickRisk * 0.18) +
        (move > 150 ? 22 : move > 100 ? 15 : move > 80 ? 8 : 0)
    )
  );

  const finalProbability = Math.round(
    clamp(
      precursor * 0.22 +
        momentum * 0.32 +
        pattern.best.similarity * 0.18 +
        premarketBurst * 0.18 +
        storySignalScore * 0.05 +
        (100 - risk) * 0.05
    )
  );
  let stage = "PRE-SURGE";
  if ((move >= 170 && risk >= 60) || (tech.closePosition !== null && tech.closePosition < 35 && move >= 80)) stage = "EXHAUSTION";
  else if (move >= 50 || (move >= 30 && momentum >= 60)) stage = "MOMENTUM EXPANSION";
  else if (move >= 15) stage = "EARLY SURGE";

  const reasons = [];
  if (preChange >= 50) reasons.push(`Premarket move ${preChange.toFixed(1)}%`);
  if (relativeVolume !== null && relativeVolume >= 10) reasons.push(`Relative volume ${relativeVolume.toFixed(1)}x`);
  else if (relativeVolume !== null && relativeVolume >= 3) reasons.push(`Relative volume ${relativeVolume.toFixed(1)}x`);
  if (preVolume >= 10_000_000) reasons.push(`Premarket volume ${(preVolume / 1_000_000).toFixed(1)}M`);
  else if (preVolume >= 1_000_000) reasons.push(`Premarket volume ${(preVolume / 1_000_000).toFixed(1)}M`);
  if (marketCap !== null && marketCap <= 300_000_000) reasons.push("Micro/small market cap");
  if (price !== null && price <= 5) reasons.push("Low-price setup");
  if (storyTags.length) reasons.push(`Story tags: ${storyTags.join(", ")}`);
  if (sourceTags.includes("news-story-signal")) reasons.push("News/story signal detected");
  if (sourceTags.includes("sec-8k-signal")) reasons.push("Recent 8-K filing signal");
  if (pattern.best.similarity >= 70) reasons.push(`${pattern.best.symbol} pattern ${pattern.best.similarity}% similar`);
  if (tech.pullbackVolumeSignal) reasons.push("Pullback or base with volume signal");
  if (tech.vwapState === "above") reasons.push("Holding above intraday VWAP");
  if (tech.rsi !== null) reasons.push(`RSI ${tech.rsi.toFixed(0)}`);
  if (risk >= 55) reasons.push("High dilution/listing/overheat risk");

  return {
    surgePrecursorScore: precursor,
    momentumExpansionScore: momentum,
    patternSimilarityScore: pattern.best.similarity,
    riskScore: risk,
    finalProbabilityScore: finalProbability,
    stage,
    stageLabel:
      stage === "PRE-SURGE" ? "급등 전조 후보" :
      stage === "EARLY SURGE" ? "초기 폭발 진행 중" :
      stage === "MOMENTUM EXPANSION" ? "추가 확장 가능" : "과열 위험",
    patternMatches: pattern.matches,
    storyTags,
    technical: tech,
    selectionReasons: reasons.length ? reasons : ["Low data coverage, watch only after stronger signal"],
    relativeVolume,
  };
}

function annotateCandidate(item, universe) {
  const model = computeScores(item);
  const excludedReasons = [];
  const price = number(item.preMarketPrice) ?? number(item.price);
  const volume = Math.max(number(item.preMarketVolume) ?? 0, number(item.volume) ?? 0);
  const hasCoreMove = (number(item.preMarketChangePercent) ?? number(item.changePercent)) !== null;

  if (!hasCoreMove) excludedReasons.push("missing priceChangePercent/premarketChangePercent");
  if (price === null) excludedReasons.push("missing price");
  if (volume <= 0) excludedReasons.push("missing volume/premarketVolume");

  const included = excludedReasons.length === 0 && (model.finalProbabilityScore >= 35 || model.surgePrecursorScore >= 45 || model.momentumExpansionScore >= 45 || WATCH_SYMBOLS.includes(cleanSymbol(item.symbol)));
  return {
    ...item,
    price,
    volume: number(item.volume),
    preMarketVolume: number(item.preMarketVolume),
    changePercent: number(item.changePercent),
    preMarketChangePercent: number(item.preMarketChangePercent),
    marketCap: number(item.marketCap),
    averageVolume: number(item.averageVolume),
    volumeRatio: model.relativeVolume,
    scannerScore: model.finalProbabilityScore,
    ...model,
    inScanUniverse: universe.has(cleanSymbol(item.symbol)),
    included,
    excludedReason: included ? null : excludedReasons.join("; ") || "below movement/score threshold",
  };
}

async function enrichCandidates(candidates, debug) {
  const priority = new Set([
    ...WATCH_SYMBOLS,
    ...candidates.slice(0, 120).map((item) => item.symbol),
  ]);
  const symbols = [...priority].filter(Boolean).slice(0, 160);
  const settled = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const [remote, extended] = await Promise.allSettled([fetchRemoteQuote(symbol), fetchExtendedQuote(symbol)]);
      return mergeCandidate(
        candidates.find((item) => item.symbol === symbol) || { symbol },
        mergeCandidate(remote.status === "fulfilled" ? remote.value : {}, extended.status === "fulfilled" ? extended.value : {})
      );
    })
  );
  const enriched = settled.filter((item) => item.status === "fulfilled").map((item) => item.value);
  debug.enrichment = {
    requested: symbols.length,
    succeeded: enriched.length,
    failed: settled.length - enriched.length,
  };
  return mergeCandidates([candidates, enriched]);
}

function buildDebug(rawCandidates, annotated, sourceStatuses, scanUniverse) {
  const symbolsIncluded = annotated.filter((item) => item.included).map((item) => item.symbol);
  const excluded = annotated.filter((item) => !item.included).slice(0, 80);
  const watch = Object.fromEntries(
    WATCH_SYMBOLS.map((symbol) => {
      const item = annotated.find((candidate) => candidate.symbol === symbol);
      return [
        symbol,
        item
          ? {
              presentInRawCandidates: true,
              included: item.included,
              excludedReason: item.excludedReason,
              sourceTags: item.sourceTags,
              preMarketChangePercent: item.preMarketChangePercent,
              preMarketVolume: item.preMarketVolume,
              scannerScore: item.scannerScore,
              stage: item.stage,
              finalProbabilityScore: item.finalProbabilityScore,
              patternSimilarityScore: item.patternSimilarityScore,
            }
          : {
              presentInRawCandidates: false,
              included: false,
              excludedReason: "not found in premarket, regular, low-price universe, or direct quote sources",
            },
      ];
    })
  );

  return {
    lastScanAt: new Date().toISOString(),
    sourceStatuses,
    rateLimited: sourceStatuses.some((status) => status.rateLimited),
    candidateCount: rawCandidates.length,
    scanUniverseCount: scanUniverse.size,
    symbolsIncluded,
    symbolsExcluded: excluded.map((item) => item.symbol),
    excludedReason: Object.fromEntries(excluded.map((item) => [item.symbol, item.excludedReason])),
    watchedSymbols: watch,
    top20RawGainers: [...annotated]
      .sort((a, b) => (b.finalProbabilityScore || 0) - (a.finalProbabilityScore || 0))
      .slice(0, 20)
      .map((item) => ({
        symbol: item.symbol,
        name: item.name,
        preMarketChangePercent: item.preMarketChangePercent,
        preMarketPrice: item.preMarketPrice,
        preMarketVolume: item.preMarketVolume,
        changePercent: item.changePercent,
        price: item.price,
        volume: item.volume,
        scannerScore: item.scannerScore,
        stage: item.stage,
        surgePrecursorScore: item.surgePrecursorScore,
        momentumExpansionScore: item.momentumExpansionScore,
        patternSimilarityScore: item.patternSimilarityScore,
        riskScore: item.riskScore,
        finalProbabilityScore: item.finalProbabilityScore,
        sourceTags: item.sourceTags,
        included: item.included,
        excludedReason: item.excludedReason,
      })),
  };
}

async function runSource(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return { result, status: sourceStatus(name, started, result) };
  } catch (error) {
    return { result: [], status: sourceStatus(name, started, [], error) };
  }
}

async function scanner({ force = false } = {}) {
  if (!force && scanCache && Date.now() - scanCache.cachedAt < SCAN_CACHE_MS) {
    return scanCache.payload;
  }

  const [
    premarket,
    stockAnalysisRegular,
    yahooRegular,
    nasdaqLowPrice,
    volumeSurge,
    storySignals,
    secSignals,
    remoteScanner,
  ] = await Promise.all([
    runSource("A stockanalysis-premarket-top50", fetchStockAnalysisPremarket),
    runSource("B stockanalysis-regular-gainers-top50", fetchStockAnalysisRegularGainers),
    runSource("B yahoo-regular-gainers-top50", fetchYahooRegularGainers),
    runSource("C nasdaq-nyse-amex-low-price-universe", fetchNasdaqLowPriceUniverse),
    runSource("C realtime-volume-surge-low-price", fetchNasdaqVolumeSurgeUniverse),
    runSource("D news-story-signal-seeds", fetchYahooStorySignals),
    runSource("E sec-8k-filing-signal-seeds", fetchSecFilingSignals),
    runSource("legacy-remote-scanner", fetchRemoteScanner),
  ]);

  const sourceStatuses = [
    premarket.status,
    stockAnalysisRegular.status,
    yahooRegular.status,
    nasdaqLowPrice.status,
    volumeSurge.status,
    storySignals.status,
    secSignals.status,
    remoteScanner.status,
  ];

  const raw = mergeCandidates([
    premarket.result,
    stockAnalysisRegular.result,
    yahooRegular.result,
    nasdaqLowPrice.result,
    volumeSurge.result,
    storySignals.result,
    secSignals.result,
    remoteScanner.result,
    WATCH_SYMBOLS.map((symbol) => ({ symbol, sourceTags: ["direct-watch-symbol"] })),
  ]);
  const scanUniverse = new Set(raw.map((item) => item.symbol));
  const intermediateDebug = {};
  const enriched = await enrichCandidates(raw, intermediateDebug);
  const annotated = enriched.map((item) => annotateCandidate(item, scanUniverse));
  const items = annotated
    .filter((item) => item.included)
    .sort((a, b) => b.scannerScore - a.scannerScore || totalMove(b) - totalMove(a))
    .slice(0, 80);
  const debug = buildDebug(raw, annotated, sourceStatuses, scanUniverse);
  debug.enrichment = intermediateDebug.enrichment;
  console.log(
    JSON.stringify({
      scanAt: debug.lastScanAt,
      candidateCount: debug.candidateCount,
      watchedSymbols: debug.watchedSymbols,
      top20: debug.top20RawGainers.map((item) => item.symbol),
    })
  );

  const payload = {
    updatedAt: debug.lastScanAt,
    source: "stockanalysis-premarket+regular-gainers+nasdaq-low-price+direct-quote",
    candidateCount: raw.length,
    items,
    debug,
  };
  scanCache = { cachedAt: Date.now(), payload };
  return payload;
}

async function quote(symbol) {
  const clean = cleanSymbol(symbol);
  if (!clean) {
    const error = new Error("Missing symbol");
    error.code = "BAD_SYMBOL";
    throw error;
  }
  const [remote, extended] = await Promise.allSettled([fetchRemoteQuote(clean), fetchExtendedQuote(clean)]);
  if (remote.status === "rejected" && extended.status === "rejected") throw remote.reason;
  const latestScan = scanCache?.payload || (await scanner());
  const scanned = latestScan.items.find((item) => item.symbol === clean);
  const merged = mergeCandidate(
    scanned || { symbol: clean },
    mergeCandidate(remote.status === "fulfilled" ? remote.value : { symbol: clean }, extended.status === "fulfilled" ? extended.value : {})
  );
  const inScan = latestScan.debug.symbolsIncluded.includes(clean);
  const watchInfo = latestScan.debug.watchedSymbols[clean];
  return {
    ...annotateCandidate(merged, new Set(latestScan.debug.symbolsIncluded)),
    inScannerResults: inScan,
    scanCandidateStatus: watchInfo || {
      presentInRawCandidates: latestScan.debug.top20RawGainers.some((item) => item.symbol === clean),
      included: inScan,
      excludedReason: inScan ? null : "not in current scanner result set",
    },
  };
}

function parseBacktestDate(value) {
  const input = value || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const date = new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    const error = new Error("Invalid date");
    error.code = "BAD_DATE";
    throw error;
  }
  return date;
}

async function fetchDailyBars(symbol, fromDate) {
  const period1 = Math.floor((fromDate.getTime() - 4 * 24 * 60 * 60 * 1000) / 1000);
  const period2 = Math.floor((fromDate.getTime() + 12 * 24 * 60 * 60 * 1000) / 1000);
  const data = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`
  );
  const result = data?.chart?.result?.[0] || data?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quoteData = result?.indicators?.quote?.[0] || {};
  return timestamps
    .map((ts, index) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      close: number(quoteData.close?.[index]),
      high: number(quoteData.high?.[index]),
      volume: number(quoteData.volume?.[index]),
    }))
    .filter((bar) => bar.close !== null || bar.high !== null);
}

async function backtest({ date, symbols } = {}) {
  const targetDate = parseBacktestDate(date);
  const testSymbols = String(symbols || BENCHMARK_SYMBOLS.join(","))
    .split(",")
    .map(cleanSymbol)
    .filter(Boolean)
    .slice(0, 20);
  const rows = await Promise.allSettled(
    testSymbols.map(async (symbol) => {
      const bars = await fetchDailyBars(symbol, targetDate);
      const startIndex = bars.findIndex((bar) => bar.date >= targetDate.toISOString().slice(0, 10));
      if (startIndex < 0) throw new Error("No price data around selected date");
      const start = bars[startIndex];
      const basePrice = start.close || start.high;
      const windows = [1, 3, 5].map((days) => {
        const future = bars.slice(startIndex, startIndex + days + 1);
        const maxHigh = Math.max(...future.map((bar) => bar.high || bar.close || 0));
        const gain = basePrice ? ((maxHigh - basePrice) / basePrice) * 100 : null;
        return { days, maxHigh, maxGainPercent: gain };
      });
      const benchmark = BENCHMARK_PATTERNS[symbol] || BENCHMARK_PATTERNS.YOOV;
      return {
        symbol,
        recommendationDate: start.date,
        recommendationPrice: basePrice,
        volumeAtRecommendation: start.volume,
        maxGain1d: windows[0].maxGainPercent,
        maxGain3d: windows[1].maxGainPercent,
        maxGain5d: windows[2].maxGainPercent,
        success: (windows[2].maxGainPercent ?? 0) >= 50,
        actualSurge: (windows[2].maxGainPercent ?? 0) >= 100,
        patternSimilarity: BENCHMARK_PATTERNS[symbol] ? 100 : similarityToBenchmark({ symbol, price: basePrice, volume: start.volume }, benchmark),
        notes: BENCHMARK_EVENT_NOTES[symbol] || ["Pattern replay based on available daily bars"],
      };
    })
  );
  return {
    date: targetDate.toISOString().slice(0, 10),
    rows: rows.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : {
            symbol: testSymbols[index],
            error: result.reason?.message || "Backtest failed",
          }
    ),
  };
}

async function exchange() {
  return fetchJson(`${REMOTE_API}/exchange`);
}

async function search(q) {
  return fetchJson(`${REMOTE_API}/search?q=${encodeURIComponent(q || "")}`);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(__dirname, requested));
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/scanner") {
      sendJson(res, 200, { ok: true, data: await scanner({ force: url.searchParams.get("force") === "1" }) });
      return;
    }
    if (url.pathname === "/api/quote") {
      sendJson(res, 200, { ok: true, data: await quote(url.searchParams.get("symbol")) });
      return;
    }
    if (url.pathname === "/api/debug") {
      sendJson(res, 200, { ok: true, data: (await scanner()).debug });
      return;
    }
    if (url.pathname === "/api/backtest") {
      sendJson(res, 200, {
        ok: true,
        data: await backtest({
          date: url.searchParams.get("date"),
          symbols: url.searchParams.get("symbols"),
        }),
      });
      return;
    }
    if (url.pathname === "/api/search") {
      sendJson(res, 200, { ok: true, data: await search(url.searchParams.get("q")) });
      return;
    }
    if (url.pathname === "/api/exchange") {
      sendJson(res, 200, { ok: true, data: await exchange() });
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      code: error.code || "API_ERROR",
      message: error.message || "Request failed",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`US stock scanner: http://${HOST}:${PORT}`);
});
