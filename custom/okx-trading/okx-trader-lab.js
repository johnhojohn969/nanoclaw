/**
 * OKX Lab Bot v1 [Active Learning] — Andy (NanoClaw)
 * Fork of v5 [Adaptive] — optimized for DATA COLLECTION, not profit maximization
 *
 * Lab differences vs v5 main:
 *  - RISK_PER_TRADE: 2% (tiny size, ~$2-3 per trade)
 *  - MAX_POSITIONS: 4 (more concurrent trades)
 *  - Entry threshold: score ≥ 0.45 (lower bar → more signals)
 *  - MAX_LEVERAGE: 5x hard cap (no 8x/12x in lab)
 *  - TP: +6% (faster cycling), SL initial: -4%
 *  - Trailing: kicks in at hwm ≥ 2% (earlier)
 *  - Shorts allowed even in extreme fear (F&G override removed)
 *  - Signal Journal: logs EVERY scan to .jsonl for post-analysis
 *  + Self-evolving adaptive layer: params.json + performance tracking + Claude reasoning
 *
 * State file: /home/john/.okx-lab-state.json
 * Journal:    /home/john/.okx-lab-journal.jsonl
 * Runs every 30min offset 15min from main bot
 */
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';

// ── Credentials ───────────────────────────────────────────────────────────────
const API_KEY = "6e04e761-ea0f-4ee1-83ee-358d1920e031";
const SECRET  = "C79E54ED0480C5EA5ABF81EB8908CC4F";
const PASS    = "AndyTaylor1@";

// ── Risk Config [LAB] ─────────────────────────────────────────────────────────
const WATCHLIST      = ["ETH-USDT-SWAP", "SOL-USDT-SWAP", "XRP-USDT-SWAP", "DOGE-USDT-SWAP", "SUI-USDT-SWAP"]; // BTC: signal only (see getBTCTrend)
const MAX_POSITIONS  = 999; // No limit — scan all symbols
const RISK_PER_TRADE = 0.02; // 2% per trade — tiny size, educational
const MAX_DRAWDOWN   = 0.15; // Tighter DD guard for lab (15%)
const LAB_MAX_LEV    = 5;    // Hard cap on leverage
const STATE_FILE     = process.env.OKX_STATE_DIR
  ? `${process.env.OKX_STATE_DIR}/okx-lab-state.json`
  : "/home/john/.okx-lab-state.json";
const JOURNAL_FILE   = process.env.OKX_STATE_DIR
  ? `${process.env.OKX_STATE_DIR}/okx-lab-journal.jsonl`
  : "/home/john/.okx-lab-journal.jsonl";

// ── Macro Calendar (Q2 2026 — research-verified) ──────────────────────────────
const MACRO_CAL = [
  { date: "2026-04-09", event: "NFP March 2026", impact: "HIGH", action: "half_size" },
  { date: "2026-04-10", event: "CPI March 2026", impact: "HIGH", action: "half_size" },
  { date: "2026-04-28", event: "FOMC Day 1", impact: "HIGH", action: "no_new_trade" },
  { date: "2026-04-29", event: "FOMC Decision", impact: "VERY_HIGH", action: "no_new_trade" },
  { date: "2026-05-07", event: "NFP April 2026", impact: "HIGH", action: "half_size" },
  { date: "2026-05-13", event: "CPI April 2026", impact: "HIGH", action: "half_size" },
  { date: "2026-06-04", event: "NFP May 2026", impact: "HIGH", action: "half_size" },
  { date: "2026-06-11", event: "CPI May 2026", impact: "HIGH", action: "half_size" },
  { date: "2026-06-16", event: "FOMC Day 1", impact: "HIGH", action: "no_new_trade" },
  { date: "2026-06-17", event: "FOMC + Dot Plot", impact: "VERY_HIGH", action: "no_new_trade" },
  { date: "2026-06-26", event: "CME BTC Quarterly Expiry", impact: "MED", action: "half_size" },
];

// ── OKX API ───────────────────────────────────────────────────────────────────
function okxReq(method, path, body = '') {
  return new Promise((resolve, reject) => {
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
    const sign = crypto.createHmac('sha256', SECRET).update(ts + method + path + body).digest('base64');
    const req = https.request({
      hostname: 'www.okx.com', path, method,
      headers: {
        'OK-ACCESS-KEY': API_KEY, 'OK-ACCESS-SIGN': sign,
        'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': PASS,
        'Content-Type': 'application/json'
      }
    }, res => { let d=''; res.on('data', c=>d+=c); res.on('end', ()=>{ try{resolve(JSON.parse(d))}catch{resolve({raw:d})} }); });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

const apiGet  = p     => okxReq('GET', p);
const _apiPostReal = (p,b) => okxReq('POST', p, JSON.stringify(b));
const DRY_RUN = process.argv.includes('--dry-run');
const apiPost = (p,b) => {
  if (DRY_RUN && p.includes('/trade/')) {
    console.log(`[DRY-RUN] SKIP trade order: ${p}`, JSON.stringify(b));
    return Promise.resolve({ code: 'DRY', data: [] });
  }
  return _apiPostReal(p, b);
};

// ── BTC Macro Signal (BTC used as signal only — not traded) ───────────────────
async function getBTCTrend() {
  try {
    const [c4h, tick] = await Promise.all([
      apiGet('/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=4H&limit=60'),
      apiGet('/api/v5/market/ticker?instId=BTC-USDT-SWAP'),
    ]);
    if (!c4h.data) return { bias: 0, label: 'btc:no_data' };
    const c4 = c4h.data.map(c => parseFloat(c[4])).reverse();
    const price = parseFloat(tick.data?.[0]?.last || c4.at(-1));
    const e20 = ema(c4, 20), e50 = ema(c4, 50);
    const r4  = rsi(c4, 14);
    const bullTrend = e20 > e50 && price > e20;
    const bearTrend = e20 < e50 && price < e20;
    const label = bullTrend ? `BTC:bull(${price.toFixed(0)})` : bearTrend ? `BTC:bear(${price.toFixed(0)})` : `BTC:mixed(${price.toFixed(0)})`;
    const bias  = bullTrend ? +0.20 : bearTrend ? -0.20 : 0;
    const rsiBias = r4 < 35 ? +0.10 : r4 > 65 ? -0.10 : 0;
    return { bias: bias + rsiBias, label, price, bullTrend, bearTrend, r4 };
  } catch {
    return { bias: 0, label: 'btc:err' };
  }
}

// ── External Data ─────────────────────────────────────────────────────────────
function fetchUrl(url, isHttps = true) {
  return new Promise((resolve) => {
    const lib = isHttps ? https : http;
    const req = lib.get(url, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve(null)} });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

async function getFearGreed() {
  const d = await fetchUrl('https://api.alternative.me/fng/?limit=5');
  if (!d?.data) return { value: 50, label: 'neutral', trend: 'flat' };
  const vals = d.data.map(x => parseInt(x.value));
  const current = vals[0];
  const avg3 = vals.slice(0, 3).reduce((a,b)=>a+b,0)/3;
  const trend = current > avg3 + 3 ? 'improving' : current < avg3 - 3 ? 'worsening' : 'flat';
  const label = current <= 20 ? 'extreme_fear' : current <= 40 ? 'fear' : current <= 60 ? 'neutral' : current <= 80 ? 'greed' : 'extreme_greed';
  return { value: current, label, trend, avg3: avg3.toFixed(0) };
}

// ── State ─────────────────────────────────────────────────────────────────────
function loadState() {
  try { if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf-8')); } catch {}
  return { peakEquity: 100, trades: [], log: [], lastTrade: {}, trailPeak: {}, lastSL: {}, oiHistory: {} };
}
function saveState(s) { try { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {} }

// ── OI history cache (for real OI divergence analysis) ───────────────────────
function pushOiSample(state, instId, oiValue) {
  if (!oiValue || !isFinite(oiValue)) return;
  if (!state.oiHistory) state.oiHistory = {};
  const rec = state.oiHistory[instId] || { samples: [] };
  rec.samples = (rec.samples || []).filter(s => s && s.ts && s.oi);
  rec.samples.push({ ts: new Date().toISOString(), oi: oiValue });
  if (rec.samples.length > 24) rec.samples = rec.samples.slice(-24);
  state.oiHistory[instId] = rec;
}
function pickOiPrev(state, instId) {
  const rec = state.oiHistory?.[instId];
  if (!rec?.samples?.length) return null;
  const now = Date.now();
  const candidates = rec.samples.filter(s => {
    const age = now - new Date(s.ts).getTime();
    return age >= 2 * 3600 * 1000 && age <= 8 * 3600 * 1000;
  });
  if (candidates.length) return candidates[0].oi;
  const oldest = rec.samples[0];
  const oldestAge = now - new Date(oldest.ts).getTime();
  return oldestAge >= 3600 * 1000 ? oldest.oi : null;
}

// ── Exchange-side SL algo sync ───────────────────────────────────────────────
async function syncExchangeSl(instId, dir, newSlTriggerPx, openDataEntry) {
  const triggerPx = formatPx(newSlTriggerPx);
  if (!triggerPx) throw new Error('invalid trigger px');
  const posSide = (dir === 'LONG' || dir === 'long') ? 'long' : 'short';
  const closeSide = posSide === 'long' ? 'sell' : 'buy';
  const knownClId = openDataEntry?.slAlgoClOrdId || null;

  if (knownClId) {
    const amend = await apiPost('/api/v5/trade/amend-algos', [{
      instId,
      algoClOrdId: knownClId,
      newSlTriggerPx: triggerPx,
      newSlOrdPx: '-1',
    }]).catch(e => ({ code: 'err', err: e.message }));
    if (amend?.code === '0') return { mode: 'amend', clId: knownClId };
  }

  const pending = await apiGet(`/api/v5/trade/orders-algo-pending?ordType=conditional&instId=${instId}`)
    .catch(() => null);
  const live = (pending?.data || []).filter(a => a.posSide === posSide && a.slTriggerPx);
  if (live.length) {
    const cancelBody = live.map(a => ({ instId, algoId: a.algoId }));
    await apiPost('/api/v5/trade/cancel-algos', cancelBody).catch(() => null);
  }
  const clId = `sl${instId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}${Date.now().toString().slice(-10)}`.slice(0, 32);
  const posResp = await apiGet(`/api/v5/account/positions?instId=${instId}`).catch(() => null);
  const live2 = (posResp?.data || []).find(p => p.posSide === posSide && Math.abs(parseFloat(p.pos)) > 0);
  const sz = live2 ? Math.abs(parseFloat(live2.pos)) : null;
  if (!sz) throw new Error('no open position for SL');
  const post = await apiPost('/api/v5/trade/order-algo', {
    instId, tdMode: 'cross',
    side: closeSide, posSide,
    ordType: 'conditional',
    sz: String(sz),
    slTriggerPx: triggerPx,
    slOrdPx: '-1',
    slTriggerPxType: 'last',
    algoClOrdId: clId,
    reduceOnly: 'true',
  });
  if (post?.code !== '0') throw new Error(`order-algo failed: ${post?.data?.[0]?.sMsg || JSON.stringify(post).slice(0,120)}`);
  if (openDataEntry) openDataEntry.slAlgoClOrdId = clId;
  return { mode: 'recreate', clId };
}

// ── Signal Journal (append-only .jsonl for post-analysis) ─────────────────────
function journalWrite(entry) {
  try {
    const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';
    appendFileSync(JOURNAL_FILE, line);
  } catch {}
}

// ── Macro Check ───────────────────────────────────────────────────────────────
function getMacroRestriction() {
  const today    = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  for (const ev of MACRO_CAL) {
    if (ev.date === today || ev.date === tomorrow)
      return { event: ev.event, action: ev.action };
  }
  return null;
}

// ── Cycle & Seasonality ───────────────────────────────────────────────────────
function getCycleContext() {
  // Halving 4: Apr 20, 2024 | ATH: $126,198 Oct 2025 | Now: ~$69K (-45% from ATH)
  const halvingDate = new Date('2024-04-20');
  const athDate     = new Date('2025-10-15'); // approximate
  const monthsPost  = (Date.now() - halvingDate) / (1000*60*60*24*30.5);
  const monthsFromATH = (Date.now() - athDate) / (1000*60*60*24*30.5);

  // Post-ATH correction phase: bearish cycle bias, but historically bottoms 12-24mo from peak
  // Based on 2022 cycle: -77% over 12-13mo. 2018: -84% over 12mo.
  // At 6mo from ATH (-45%), likely still early in correction unless ETF demand floors it
  const phase = 'post_ath_correction';
  const cycleBias = -0.15; // bearish from cycle position

  const now   = new Date();
  const month = now.getMonth() + 1;
  const dow   = now.getDay();

  // Research-verified seasonality (BTC monthly win rate)
  const monthBias = {
    1:+0.20, 2:+0.15, 3:+0.05, 4:+0.08, 5:-0.02,
    6:-0.05, 7:+0.12, 8:-0.03, 9:-0.18, 10:+0.22, 11:+0.20, 12:+0.08
  };
  // September "Rektember" = strongest negative seasonality (-18% bias)
  // October "Uptober" = strongest positive (+22%)

  // Day-of-week: Tuesday highest vol (good for breakout trades)
  const dowBias = [0, +0.03, +0.05, 0, -0.03, 0, 0][dow];

  return {
    phase, cycleBias, monthsPost: monthsPost.toFixed(1),
    monthsFromATH: monthsFromATH.toFixed(1),
    seasonalBias: (monthBias[month] || 0) + dowBias,
    monthLabel: `month=${month}(${monthBias[month]>=0?'+':''}${monthBias[month]})`,
    sep_warning: month === 9
  };
}

// ── Sentiment Layer ───────────────────────────────────────────────────────────
function getFGSignal(fg) {
  // Research: F&G < 15 → 64% positive 7-day return (contrarian buy)
  // Research: F&G > 80 → 58% negative 7-day return (contrarian sell)
  if (fg.value <= 15) {
    const strength = fg.value <= 10 ? 0.55 : 0.35;
    const label = `ExtremeFear(${fg.value})→contrarian_LONG`;
    return { bias: +strength, label, isExtremeSignal: true };
  }
  if (fg.value >= 80) {
    const strength = fg.value >= 90 ? -0.45 : -0.25;
    return { bias: strength, label: `ExtremeGreed(${fg.value})→contrarian_SHORT`, isExtremeSignal: true };
  }
  if (fg.value <= 30) return { bias: +0.15, label: `Fear(${fg.value})`, isExtremeSignal: false };
  if (fg.value >= 70) return { bias: -0.10, label: `Greed(${fg.value})`, isExtremeSignal: false };
  return { bias: 0, label: `Neutral(${fg.value})`, isExtremeSignal: false };
}

// ── Technical Indicators ──────────────────────────────────────────────────────
const ema = (p, n) => { const k=2/(n+1); let e=p[0]; for(let i=1;i<p.length;i++) e=p[i]*k+e*(1-k); return e; };

function rsi(c, n=14) {
  if (c.length < n+1) return 50;
  let g=0, l=0;
  for (let i=c.length-n; i<c.length; i++) { const d=c[i]-c[i-1]; d>0?g+=d:l-=d; }
  return 100 - 100/(1+g/(l||.001));
}

function macd(p, f=12, s=26, sig=9) {
  if (p.length < s+sig) return { hist: 0, prevHist: 0, line: 0 };
  const ml = p.map((_,i) => i>=s-1 ? ema(p.slice(0,i+1),f)-ema(p.slice(0,i+1),s) : null).filter(x=>x!==null);
  const sl = ml.map((_,i) => ema(ml.slice(0,i+1),sig));
  const hist = ml.map((m,i)=>m-sl[i]);
  return { hist: hist.at(-1), prevHist: hist.at(-2)||0, line: ml.at(-1) };
}

function bollinger(c, n=20, m=2) {
  const s=c.slice(-n), mean=s.reduce((a,b)=>a+b,0)/n;
  const std=Math.sqrt(s.reduce((a,b)=>a+(b-mean)**2,0)/n);
  return { upper:mean+m*std, mid:mean, lower:mean-m*std };
}

function rsiDiv(closes, n=14, lb=20) {
  const rv=[]; for(let i=n;i<=closes.length;i++) rv.push(rsi(closes.slice(0,i),n));
  if (rv.length<lb) return 'none';
  const ps=closes.slice(-lb), rs=rv.slice(-lb);
  const h=Math.floor(lb/2);
  if (Math.min(...ps.slice(h))<Math.min(...ps.slice(0,h))*0.998 && Math.min(...rs.slice(h))>Math.min(...rs.slice(0,h))*1.02) return 'bullish';
  if (Math.max(...ps.slice(h))>Math.max(...ps.slice(0,h))*1.002 && Math.max(...rs.slice(h))<Math.max(...rs.slice(0,h))*0.98) return 'bearish';
  return 'none';
}

// ── ATR (Average True Range) ──────────────────────────────────────────────────
function atr(rawCandles, n = 14) {
  if (!rawCandles || rawCandles.length < n + 1) return null;
  const c = rawCandles.slice(0, n + 1).reverse();
  let sum = 0;
  for (let i = 1; i < c.length; i++) {
    const high = parseFloat(c[i][2]);
    const low  = parseFloat(c[i][3]);
    const prev = parseFloat(c[i - 1][4]);
    const tr = Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev));
    sum += tr;
  }
  return sum / (c.length - 1);
}

// ── Universal instrument profile (ATR + liquidity, no per-coin tuning) ──────
function getInstrumentProfile(c1hRaw, tickerRow, price, maxLevCap) {
  const atr1h = atr(c1hRaw, 14);
  if (!atr1h || !isFinite(atr1h) || !price) return null;
  const atrPct = atr1h / price;
  const volUsd = parseFloat(tickerRow?.volCcy24h || 0) * price;
  const liquidityScore = Math.min(1, Math.max(0, (Math.log10(Math.max(volUsd, 1e6)) - 7) / 2));
  const sizeMult = 0.4 + 0.6 * liquidityScore;
  const maxLevFromVol = Math.max(3, Math.round(0.12 / Math.max(atrPct, 0.005)));
  const maxLev = Math.min(maxLevCap, maxLevFromVol);
  return {
    atr: atr1h, atrPct, volUsd, liquidityScore, sizeMult, maxLev,
    k_sl: 1.5, k_tp: 3.0,
  };
}

function getCurrentSession() {
  const hour = new Date().getUTCHours();
  if (hour < 8)  return 'asian';
  if (hour < 13) return 'london';
  return 'ny';
}

function ladderSlToPrice(entryPrice, slUplRatio, leverage, direction) {
  if (!entryPrice || !leverage) return null;
  const pctFromEntry = slUplRatio / leverage;
  const isLong = direction === 'long' || direction === 'LONG';
  return isLong
    ? entryPrice * (1 + pctFromEntry)
    : entryPrice * (1 - pctFromEntry);
}

function formatPx(p) {
  if (p == null || !isFinite(p)) return null;
  return Number(p).toPrecision(6);
}

function detectLiqSweep(c4h, lookback=10) {
  // Liquidity sweep: price briefly breaks below recent low then recovers above
  // = stop hunt before reversal — high win-rate long entry (68-72%)
  const recent = c4h.slice(-lookback);
  if (recent.length < lookback) return null;
  const lows   = recent.map(c=>parseFloat(c[3]));
  const closes = recent.map(c=>parseFloat(c[4]));
  const prevLow = Math.min(...lows.slice(0, -2));
  const lastLow   = lows.at(-2);
  const lastClose = closes.at(-1);
  const prevClose = closes.at(-2);
  // Swept below prev low then closed above it → bullish sweep
  if (lastLow < prevLow * 0.999 && prevClose > prevLow && lastClose > prevLow) return 'bullish_sweep';
  // Swept above prev high then closed below → bearish sweep
  const highs   = recent.map(c=>parseFloat(c[2]));
  const prevHigh = Math.max(...highs.slice(0, -2));
  if (highs.at(-2) > prevHigh * 1.001 && closes.at(-1) < prevHigh) return 'bearish_sweep';
  return null;
}

function detectFVG(c4h) {
  // Fair Value Gap: candle[i-2] and candle[i] have no overlap (imbalance)
  // These often act as magnets → price returns to fill them
  const last3 = c4h.slice(-3);
  if (last3.length < 3) return null;
  const [c1,c2,c3] = last3.map(c=>({h:parseFloat(c[2]),l:parseFloat(c[3]),c:parseFloat(c[4])}));
  // Bullish FVG: c1.high < c3.low (gap above c1, below c3)
  if (c1.h < c3.l) return { type: 'bullish', upper: c3.l, lower: c1.h };
  // Bearish FVG: c1.low > c3.high (gap below c1, above c3)
  if (c1.l > c3.h) return { type: 'bearish', upper: c1.l, lower: c3.h };
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// SMART MONEY CONCEPTS ENGINE v1
// Phân tích tâm lý nhỏ lẻ vs smart money, bẫy, Wyckoff, OI divergence
// ════════════════════════════════════════════════════════════════════════════

/**
 * BULL TRAP detection — false breakout above resistance, retail FOMO'd in
 * Smart money distributed at the top → price reverses hard → SHORT signal
 *
 * Conditions (4H candles):
 *  1. Price broke above 20-period high (N-day breakout)
 *  2. Volume on breakout candle BELOW 20-period average (no institutional buying)
 *     OR volume was high but NEXT candle reversed with equal/higher volume
 *  3. Bearish RSI divergence (price new high, RSI lower high)
 *  4. Price now back BELOW the breakout level (confirmed trap)
 *
 * Win rate: ~62-68% on 4H timeframe (SMC research)
 */
function detectBullTrap(c4h_raw, rsi4vals) {
  const c = c4h_raw.slice().reverse(); // oldest → newest
  if (c.length < 25) return null;

  const lookback = 20;
  const recent   = c.slice(-lookback);
  const last2    = c.slice(-2);
  const curr     = c.slice(-1)[0];

  const highs   = recent.map(x => parseFloat(x[2]));
  const closes  = recent.map(x => parseFloat(x[4]));
  const volumes = recent.map(x => parseFloat(x[5]));

  const prevHigh  = Math.max(...highs.slice(0, -1));   // max of prior candles
  const currHigh  = parseFloat(curr[2]);
  const currClose = parseFloat(curr[4]);
  const prevClose = parseFloat(last2[0][4]);
  const avgVol    = volumes.slice(0, -1).reduce((a,b)=>a+b,0) / (lookback-1);
  const currVol   = parseFloat(curr[5]);

  // Breakout happened (prev or curr candle made new high)
  const hadBreakout = Math.max(parseFloat(last2[0][2]), currHigh) > prevHigh * 1.002;
  if (!hadBreakout) return null;

  // Price NOW back below the breakout level = trap confirmed
  const breakoutLevel = prevHigh;
  const priceBackBelow = currClose < breakoutLevel * 1.001;
  if (!priceBackBelow) return null;

  // Low volume on breakout = distribution, not accumulation
  const lowVolBreakout = currVol < avgVol * 0.85;

  // RSI divergence: price new high but RSI lower (bearish div)
  const rsiLen = rsi4vals.length;
  const rsiDiv = rsiLen >= 8 &&
    rsi4vals.at(-1) < rsi4vals.slice(-8,-1).reduce((a,b)=>Math.max(a,b),0) * 0.97;

  // Rejection wick: long upper wick (>40% of candle range) = smart money selling
  const range    = parseFloat(curr[2]) - parseFloat(curr[3]);
  const bodyTop  = Math.max(parseFloat(curr[1]), currClose);
  const upperWick = parseFloat(curr[2]) - bodyTop;
  const longUpperWick = range > 0 && (upperWick / range) > 0.40;

  const signals = [lowVolBreakout, rsiDiv, longUpperWick].filter(Boolean).length;
  if (signals < 1) return null; // need at least 1 confirmation

  const strength = signals >= 2 ? 'strong' : 'weak';
  return {
    type: 'bull_trap',
    strength,
    breakoutLevel: breakoutLevel.toFixed(2),
    signals: [
      lowVolBreakout && 'low_vol_breakout',
      rsiDiv         && 'rsi_bearish_div',
      longUpperWick  && 'rejection_wick',
    ].filter(Boolean),
    bias: -(signals >= 2 ? 0.65 : 0.35), // SHORT bias
  };
}

/**
 * BEAR TRAP detection — false breakdown below support, retail panic-sold
 * Smart money accumulated at the lows → price recovers → LONG signal
 *
 * Conditions:
 *  1. Price broke below 20-period low (panic/stop cascade)
 *  2. Spike in volume (capitulation = retail panic + smart money absorbing)
 *  3. Bullish RSI divergence (price new low, RSI higher low)
 *  4. Price recovered ABOVE breakdown level same candle or next
 *
 * Win rate: ~65-72% on 4H (bear traps in downtrends are high-probability)
 */
function detectBearTrap(c4h_raw, rsi4vals) {
  const c = c4h_raw.slice().reverse();
  if (c.length < 25) return null;

  const lookback = 20;
  const recent   = c.slice(-lookback);
  const curr     = c.slice(-1)[0];
  const prev     = c.slice(-2, -1)[0];

  const lows    = recent.map(x => parseFloat(x[3]));
  const closes  = recent.map(x => parseFloat(x[4]));
  const volumes = recent.map(x => parseFloat(x[5]));

  const prevLow   = Math.min(...lows.slice(0, -1));
  const currLow   = parseFloat(curr[3]);
  const currClose = parseFloat(curr[4]);
  const avgVol    = volumes.slice(0, -1).reduce((a,b)=>a+b,0) / (lookback-1);
  const currVol   = parseFloat(curr[5]);

  // Breakdown happened (below prior 20-period low)
  const hadBreakdown = Math.min(parseFloat(prev[3]), currLow) < prevLow * 0.998;
  if (!hadBreakdown) return null;

  // Price recovered above breakdown level = trap confirmed
  const breakdownLevel = prevLow;
  const priceRecovered = currClose > breakdownLevel * 0.999;
  if (!priceRecovered) return null;

  // High volume = capitulation/absorption (smart money buying panic sellers)
  const highVolCapitulation = currVol > avgVol * 1.4;

  // RSI divergence: price new low but RSI higher (bullish div)
  const rsiLen = rsi4vals.length;
  const rsiDiv = rsiLen >= 8 &&
    rsi4vals.at(-1) > rsi4vals.slice(-8,-1).reduce((a,b)=>Math.min(a,b),100) * 1.03;

  // Long lower wick = rejection of lower prices (smart money defending)
  const range     = parseFloat(curr[2]) - parseFloat(curr[3]);
  const bodyBot   = Math.min(parseFloat(curr[1]), currClose);
  const lowerWick = bodyBot - parseFloat(curr[3]);
  const longLowerWick = range > 0 && (lowerWick / range) > 0.40;

  const signals = [highVolCapitulation, rsiDiv, longLowerWick].filter(Boolean).length;
  if (signals < 1) return null;

  const strength = signals >= 2 ? 'strong' : 'weak';
  return {
    type: 'bear_trap',
    strength,
    breakdownLevel: breakdownLevel.toFixed(2),
    signals: [
      highVolCapitulation && 'capitulation_vol',
      rsiDiv              && 'rsi_bullish_div',
      longLowerWick       && 'rejection_wick',
    ].filter(Boolean),
    bias: +(signals >= 2 ? 0.65 : 0.35), // LONG bias
  };
}

/**
 * WYCKOFF SPRING — refined bear trap
 * Spring = final shakeout below accumulation range support before markup
 * Higher win rate than generic bear trap because of phase context
 *
 * Key difference from bear trap:
 *  - Must occur in a ranging/basing structure (not free-fall)
 *  - Volume on spring candle is relatively LOWER than prior selling (supply exhausted)
 *  - Next candle must close back above the range low (Sign of Strength)
 *
 * Win rate: ~70-75% when volume + range confirmed
 */
function detectWyckoffSpring(c4h_raw, rsi4vals) {
  const c = c4h_raw.slice().reverse();
  if (c.length < 40) return null;

  const rangePeriod = 30;
  const rangeCandles = c.slice(-rangePeriod, -2);
  const rangeHigh = Math.max(...rangeCandles.map(x => parseFloat(x[2])));
  const rangeLow  = Math.min(...rangeCandles.map(x => parseFloat(x[3])));
  const rangeSize = rangeHigh - rangeLow;

  // Must be in a range (not trending): range < 25% of mid price
  const rangeMid = (rangeHigh + rangeLow) / 2;
  if (rangeSize / rangeMid > 0.25) return null; // too trending

  const curr  = c.slice(-1)[0];
  const prev  = c.slice(-2,-1)[0];

  const currLow   = parseFloat(curr[3]);
  const currClose = parseFloat(curr[4]);
  const prevLow   = parseFloat(prev[3]);

  // Spring: broke below range low
  const brokeBelow = currLow < rangeLow * 0.998;
  if (!brokeBelow) return null;

  // Recovered back into range = spring confirmed
  const recovered = currClose > rangeLow;
  if (!recovered) return null;

  // Wyckoff spring volume: should be LOWER than the big selling candles before it
  const rangeVolumes = rangeCandles.map(x => parseFloat(x[5]));
  const maxPriorVol  = Math.max(...rangeVolumes);
  const currVol      = parseFloat(curr[5]);
  const exhaustedVol = currVol < maxPriorVol * 0.8; // supply exhausted

  // RSI oversold
  const rsiOS = rsi4vals.length > 0 && rsi4vals.at(-1) < 35;

  const strength = (exhaustedVol && rsiOS) ? 'strong' : exhaustedVol || rsiOS ? 'medium' : 'weak';

  return {
    type: 'wyckoff_spring',
    strength,
    rangeLow: rangeLow.toFixed(2), rangeHigh: rangeHigh.toFixed(2),
    signals: [
      exhaustedVol && 'supply_exhausted',
      rsiOS        && 'rsi_oversold',
    ].filter(Boolean),
    bias: +(strength === 'strong' ? 0.75 : strength === 'medium' ? 0.55 : 0.35),
  };
}

/**
 * UTAD — Upthrust After Distribution
 * False breakout above distribution range top before markdown begins
 * Mirror of Wyckoff Spring: smart money trapped late longs
 *
 * Win rate: ~68-72%
 */
function detectUTAD(c4h_raw, rsi4vals) {
  const c = c4h_raw.slice().reverse();
  if (c.length < 40) return null;

  const rangePeriod  = 30;
  const rangeCandles = c.slice(-rangePeriod, -2);
  const rangeHigh    = Math.max(...rangeCandles.map(x => parseFloat(x[2])));
  const rangeLow     = Math.min(...rangeCandles.map(x => parseFloat(x[3])));
  const rangeSize    = rangeHigh - rangeLow;
  const rangeMid     = (rangeHigh + rangeLow) / 2;

  // Must be ranging
  if (rangeSize / rangeMid > 0.25) return null;

  const curr  = c.slice(-1)[0];
  const currHigh  = parseFloat(curr[2]);
  const currClose = parseFloat(curr[4]);

  // UTAD: broke above range high then fell back below it
  const brokeAbove = currHigh > rangeHigh * 1.002;
  if (!brokeAbove) return null;
  const fell = currClose < rangeHigh * 1.001;
  if (!fell) return null;

  // Volume: UTAD often has high volume as retail chases breakout, smart money sells into it
  const rangeVolumes = rangeCandles.map(x => parseFloat(x[5]));
  const avgRangeVol  = rangeVolumes.reduce((a,b)=>a+b,0) / rangeVolumes.length;
  const currVol      = parseFloat(curr[5]);
  const highVol      = currVol > avgRangeVol * 1.2; // demand met by supply

  // RSI overbought
  const rsiOB = rsi4vals.length > 0 && rsi4vals.at(-1) > 65;

  // Rejection wick
  const bodyTop   = Math.max(parseFloat(curr[1]), currClose);
  const upperWick = currHigh - bodyTop;
  const totalRange = currHigh - parseFloat(curr[3]);
  const wickRejection = totalRange > 0 && upperWick / totalRange > 0.35;

  const signals = [highVol, rsiOB, wickRejection].filter(Boolean).length;
  if (signals < 1) return null;

  const strength = signals >= 2 ? 'strong' : 'weak';
  return {
    type: 'utad',
    strength,
    rangeHigh: rangeHigh.toFixed(2),
    signals: [
      highVol       && 'demand_met_by_supply',
      rsiOB         && 'rsi_overbought',
      wickRejection && 'rejection_wick',
    ].filter(Boolean),
    bias: -(signals >= 2 ? 0.70 : 0.40), // SHORT bias
  };
}

/**
 * STOP HUNT / LIQUIDITY GRAB detection
 * Smart money engineers price to sweep resting stop orders (clustered at
 * obvious support/resistance, round numbers) then reverses hard.
 *
 * Round number psychology: retail places stops at $70k/$2000/$100 etc.
 * Smart money pushes through these levels to fill at those prices, then reverses.
 *
 * Enhanced version of existing liqSweep with round-number awareness
 */
function detectStopHunt(c4h_raw, price) {
  const c = c4h_raw.slice().reverse();
  if (c.length < 15) return null;

  const lookback = 12;
  const recent   = c.slice(-lookback);
  const curr     = c.slice(-1)[0];
  const prev     = c.slice(-2,-1)[0];

  const lows    = recent.map(x => parseFloat(x[3]));
  const highs   = recent.map(x => parseFloat(x[2]));
  const closes  = recent.map(x => parseFloat(x[4]));

  const prevStructureLow  = Math.min(...lows.slice(0,-2));
  const prevStructureHigh = Math.max(...highs.slice(0,-2));

  const currLow   = parseFloat(curr[3]);
  const currClose = parseFloat(curr[4]);
  const currHigh  = parseFloat(curr[2]);
  const prevClose = parseFloat(prev[4]);

  // Round number proximity (retail stop magnet)
  const magnitude = price > 10000 ? 1000 : price > 1000 ? 100 : price > 100 ? 10 : 1;
  const nearestRound = Math.round(price / magnitude) * magnitude;
  const distToRound  = Math.abs(price - nearestRound) / price;
  const nearRound    = distToRound < 0.005; // within 0.5% of round number

  // Bullish stop hunt: swept below structure low, recovered above
  if (currLow < prevStructureLow * 0.998 && currClose > prevStructureLow) {
    const swept = (prevStructureLow - currLow) / prevStructureLow;
    return {
      type: 'stop_hunt_bullish',
      swept: (swept*100).toFixed(2)+'%',
      level: prevStructureLow.toFixed(2),
      nearRound, nearestRound,
      bias: +(nearRound ? 0.60 : 0.45), // round number = stronger signal
    };
  }

  // Bearish stop hunt: swept above structure high, fell back below
  if (currHigh > prevStructureHigh * 1.002 && currClose < prevStructureHigh) {
    const swept = (currHigh - prevStructureHigh) / prevStructureHigh;
    return {
      type: 'stop_hunt_bearish',
      swept: (swept*100).toFixed(2)+'%',
      level: prevStructureHigh.toFixed(2),
      nearRound, nearestRound,
      bias: -(nearRound ? 0.60 : 0.45),
    };
  }

  return null;
}

/**
 * ABSORPTION / STOPPING VOLUME
 * Large volume candle with small body = smart money absorbing supply/demand
 * Precursor to reversal — especially at key levels
 *
 * Body/Range ratio < 0.3 on high volume = absorption
 */
function detectAbsorption(c4h_raw) {
  const c = c4h_raw.slice().reverse();
  if (c.length < 10) return null;

  const curr    = c.slice(-1)[0];
  const volumes = c.slice(-10).map(x => parseFloat(x[5]));
  const avgVol  = volumes.slice(0,-1).reduce((a,b)=>a+b,0) / 9;
  const currVol = parseFloat(curr[5]);

  if (currVol < avgVol * 1.5) return null; // need significantly high volume

  const open  = parseFloat(curr[1]);
  const close = parseFloat(curr[4]);
  const high  = parseFloat(curr[2]);
  const low   = parseFloat(curr[3]);
  const range = high - low;
  const body  = Math.abs(close - open);

  if (range === 0) return null;
  const bodyRatio = body / range;
  if (bodyRatio > 0.35) return null; // body too large, not absorption

  // Determine context: where did absorption happen?
  const highs20 = c.slice(-20).map(x => parseFloat(x[2]));
  const lows20  = c.slice(-20).map(x => parseFloat(x[3]));
  const h20     = Math.max(...highs20);
  const l20     = Math.min(...lows20);

  const atTop    = close > h20 * 0.96;  // absorption near top = distribution
  const atBottom = close < l20 * 1.04;  // absorption near bottom = accumulation

  return {
    type: 'absorption',
    volRatio: (currVol/avgVol).toFixed(1) + 'x',
    bodyRatio: bodyRatio.toFixed(2),
    context: atBottom ? 'accumulation' : atTop ? 'distribution' : 'neutral',
    bias: atBottom ? +0.30 : atTop ? -0.30 : 0,
  };
}

/**
 * FUNDING RATE TRAP ANALYSIS
 * Extreme funding = one side extremely crowded = smart money target for squeeze
 */
function analyzeFundingTrap(fr, price, fg) {
  if (fr > 0.08) {
    const severity = fr > 0.15 ? 'extreme' : fr > 0.10 ? 'high' : 'elevated';
    return {
      type: 'long_crowded',
      fr: fr.toFixed(4) + '%',
      severity,
      combined_with_fear: fg.value <= 25,
      bias: fr > 0.15 ? -0.40 : -0.25,
    };
  }
  if (fr < -0.05) {
    const severity = fr < -0.10 ? 'extreme' : 'elevated';
    return {
      type: 'short_crowded',
      fr: fr.toFixed(4) + '%',
      severity,
      combined_with_greed: fg.value >= 70,
      bias: fr < -0.10 ? +0.45 : +0.25,
    };
  }
  return null;
}

/**
 * RETAIL vs SMART MONEY PSYCHOLOGY COMPOSITE
 */
function analyzeRetailPsychology(fg, cycle, m) {
  const signals = [];
  let bias = 0;

  if (fg.value >= 70 && m.nearHigh && m.dailyBull) {
    signals.push('retail_FOMO@top→SM_distributing');
    bias -= 0.35;
  }

  if (fg.value <= 20 && m.nearLow && cycle.phase === 'post_ath_correction') {
    signals.push('retail_panic@bottom→SM_accumulating');
    bias += 0.40;
  }

  if (fg.trend === 'improving' && fg.value > 45 && m.nearHigh && m.vr < 1.0) {
    signals.push('retail_chasing_breakout→low_vol→potential_trap');
    bias -= 0.20;
  }

  if (fg.trend === 'worsening' && fg.value < 30 && m.nearLow && m.vr > 1.5) {
    signals.push('retail_capitulating→high_vol→bear_trap_setup');
    bias += 0.25;
  }

  if (m.fundLong && fg.value <= 25) {
    signals.push('post_long_flush_potential→wait_confirmation');
    bias += 0.15;
  }

  return { signals, bias, label: signals.join(' + ') || 'neutral' };
}

/**
 * LONG/SHORT RATIO ANALYSIS (OKX data)
 */
function analyzeLSRatio(lsRatio) {
  if (!lsRatio) return { bias: 0, label: 'no_data' };
  const longPct = lsRatio * 100;

  if (longPct > 0.65) {
    return { bias: -0.35, label: `LSR:${(longPct*100).toFixed(0)}%long→SM_short`, isExtreme: true };
  }
  if (longPct > 0.60) {
    return { bias: -0.20, label: `LSR:${(longPct*100).toFixed(0)}%long→crowded`, isExtreme: false };
  }
  if (longPct < 0.35) {
    return { bias: +0.35, label: `LSR:${(longPct*100).toFixed(0)}%long→SM_long`, isExtreme: true };
  }
  if (longPct < 0.40) {
    return { bias: +0.20, label: `LSR:${(longPct*100).toFixed(0)}%long→short_crowd`, isExtreme: false };
  }
  return { bias: 0, label: `LSR:${(longPct*100).toFixed(0)}%long→neutral` };
}

/**
 * OPEN INTEREST DIVERGENCE
 */
function analyzeOIDivergence(oiCurrent, oiPrev, priceChange) {
  if (!oiCurrent || !oiPrev) return { bias: 0, label: 'no_OI_data' };
  const oiChange = (oiCurrent - oiPrev) / oiPrev;
  const priceUp  = priceChange > 0.005;
  const priceDown = priceChange < -0.005;
  const oiUp     = oiChange > 0.01;
  const oiDown   = oiChange < -0.01;

  if (priceUp && oiDown)    return { bias: -0.30, label: `OI:↑p/↓oi=short_cover→weak` };
  if (priceDown && oiDown)  return { bias: +0.20, label: `OI:↓p/↓oi=long_liq→near_bottom` };
  if (priceUp && oiUp)      return { bias: +0.15, label: `OI:↑p/↑oi=real_buying✓` };
  if (priceDown && oiUp)    return { bias: -0.15, label: `OI:↓p/↑oi=new_shorts✓` };
  return { bias: 0, label: 'OI:neutral' };
}

// ════════════════════════════════════════════════════════════════════════════
// END SMART MONEY ENGINE
// ════════════════════════════════════════════════════════════════════════════

// ── Full Market Analysis ──────────────────────────────────────────────────────
async function analyzeMarket(instId, fg = { value: 50 }, oiPrev = null, maxLev = 5) {
  const [c1h, c4h, c1d, tick, fund, oi, lsr] = await Promise.all([
    apiGet(`/api/v5/market/candles?instId=${instId}&bar=1H&limit=150`),
    apiGet(`/api/v5/market/candles?instId=${instId}&bar=4H&limit=100`),
    apiGet(`/api/v5/market/candles?instId=${instId}&bar=1D&limit=60`),
    apiGet(`/api/v5/market/ticker?instId=${instId}`),
    apiGet(`/api/v5/public/funding-rate?instId=${instId}`),
    apiGet(`/api/v5/public/open-interest?instId=${instId}`),
    apiGet(`/api/v5/rubik/stat/contracts/long-short-account-ratio-contract?instId=${instId}&period=1H&limit=3`),
  ]);
  if (!c1h.data || !c4h.data) return null;

  const c1  = c1h.data.map(c=>parseFloat(c[4])).reverse();
  const c4  = c4h.data.map(c=>parseFloat(c[4])).reverse();
  const cd  = c1d.data.map(c=>parseFloat(c[4])).reverse();
  const v1  = c1h.data.map(c=>parseFloat(c[5])).reverse();

  const tickerRow = tick.data?.[0] || null;
  const price = parseFloat(tickerRow?.last || c1.at(-1));
  const fr    = parseFloat(fund.data?.[0]?.fundingRate||0)*100;

  const oiCurrent = oi.data?.[0] ? parseFloat(oi.data[0].oi) : null;
  const priceChg24h = tickerRow ? (parseFloat(tickerRow.last) - parseFloat(tickerRow.open24h)) / parseFloat(tickerRow.open24h) : 0;

  const lsrData   = lsr.data?.[0] ? parseFloat(lsr.data[0].longShortRatio) : null;
  const lsrLongPct = lsrData ? lsrData / (1 + lsrData) : null;

  const r1=rsi(c1,14), r4=rsi(c4,14), rd=rsi(cd,14);

  const rsi4rolling = [];
  for (let i = 14; i <= c4.length; i++) rsi4rolling.push(rsi(c4.slice(0,i), 14));

  const macd4 = macd(c4);
  const e20=ema(c4,20), e50=ema(c4,50), e200=ema(c4,Math.min(200,c4.length));
  const e20d=ema(cd,20), e50d=ema(cd,50);
  const bb=bollinger(c1,20);
  const bbp=(price-bb.lower)/(bb.upper-bb.lower||1);
  const vr=(v1.slice(-3).reduce((a,b)=>a+b,0)/3)/(v1.slice(-20,-3).reduce((a,b)=>a+b,0)/17||1);
  const div4=rsiDiv(c4,14,20), div1=rsiDiv(c1,14,15);
  const liqSweep=detectLiqSweep(c4h.data.slice(0,20).reverse());
  const fvg=detectFVG(c4h.data.slice(0,3).reverse());
  const bullTrend=e20>e50&&price>e200, bearTrend=e20<e50&&price<e200;
  const dailyBull=e20d>e50d;
  const h20=Math.max(...cd.slice(-20)), l20=Math.min(...cd.slice(-20));
  const fundLong=fr>0.08, fundShort=fr<-0.05;
  const nearHigh=price>h20*0.98, nearLow=price<l20*1.02;

  // Universal instrument profile (ATR volatility + liquidity normalized)
  const profile = getInstrumentProfile(c1h.data, tickerRow, price, maxLev);

  const c4raw = c4h.data;
  const smc = {
    bullTrap:    detectBullTrap(c4raw, rsi4rolling),
    bearTrap:    detectBearTrap(c4raw, rsi4rolling),
    wyckoff:     detectWyckoffSpring(c4raw, rsi4rolling),
    utad:        detectUTAD(c4raw, rsi4rolling),
    stopHunt:    detectStopHunt(c4raw, price),
    absorption:  detectAbsorption(c4raw),
    fundingTrap: analyzeFundingTrap(fr, price, fg),            // FIX: real F&G
    lsr:         analyzeLSRatio(lsrLongPct),
    oiDiv:       analyzeOIDivergence(oiCurrent, oiPrev, priceChg24h), // FIX: real oiPrev
  };

  return {
    price, fr, r1, r4, rd, macd4, bb, bbp, vr,
    div4, div1, liqSweep, fvg,
    bullTrend, bearTrend, dailyBull,
    fundLong, fundShort, nearHigh, nearLow,
    trend4h: bullTrend?'BULL':bearTrend?'BEAR':'MIXED',
    smc, oiCurrent, lsrLongPct, priceChg24h,
    rsi4rolling,
    profile,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ADAPTIVE LAYER [LAB] — params, performance, Claude reasoning, self-evolution
// ════════════════════════════════════════════════════════════════════════════

const _STATE_DIR  = process.env.OKX_STATE_DIR || "/home/john/.nanoclaw";
const PARAMS_FILE = `${_STATE_DIR}/params.json`;
const PERF_FILE   = `${_STATE_DIR}/performance.json`;
const JOURNAL_FILE_NANOCLAW = `${_STATE_DIR}/journal.jsonl`;

function loadClaudeToken() {
  try {
    const e = readFileSync('/workspace/extra/git/nanoclaw/.env', 'utf-8');
    return (e.match(/CLAUDE_CODE_OAUTH_TOKEN=(.+)/)?.[1] || '').trim();
  } catch { return ''; }
}

function loadParams() {
  try {
    if (existsSync(PARAMS_FILE)) return JSON.parse(readFileSync(PARAMS_FILE, 'utf-8'));
  } catch {}
  return {
    version: 0, update_reason: 'defaults',
    risk: { risk_per_trade_lab: 0.02, max_positions_lab: 999, max_drawdown_lab: 0.15, max_leverage_lab: 5, reentry_cooldown_ms: 14400000 },
    entry: { threshold_lab: 0.45, ambiguous_zone_low: 0.35, ambiguous_zone_high: 0.65, tp_lab: 0.06, initial_sl_lab: -0.04 },
    leverage_tiers_lab: { l2: 0.45, l3: 0.70, l4: 0.90, l5: 1.10 },
    trailing_sl_lab: { t0_sl: -0.04, t0_hwm: 0.00, t1_sl: 0.00, t1_hwm: 0.02, t2_sl: 0.02, t2_hwm: 0.04, t3_trail: 0.03, t3_hwm: 0.08, t4_pct: 0.70, t4_hwm: 0.12, macro_tighten: -0.02 },
    signal_weights: { btc_trend: 0.6, cycle_bias: 0.8, seasonal_bias: 0.5, daily_trend: 0.25, trend_4h: 0.25, rsi_daily_os: 0.40, rsi_daily_ob: -0.35, rsi_4h_os: 0.40, rsi_4h_ob: -0.30, rsi_1h_os: 0.25, rsi_1h_ob: -0.20, rsi_div_4h: 0.45, rsi_div_1h: 0.20, macd: 0.20, bollinger: 0.30, key_level: 0.15, funding_rate: 0.30, liq_sweep: 0.50, fvg: 0.25, vol_high_mult: 1.25, vol_low_mult: 0.80, smc_wyckoff_strong: 0.75, smc_wyckoff_medium: 0.55, smc_wyckoff_weak: 0.35, smc_utad_strong: 0.70, smc_utad_weak: 0.40, smc_bull_trap_strong: 0.65, smc_bull_trap_weak: 0.35, smc_bear_trap_strong: 0.65, smc_bear_trap_weak: 0.35, stop_hunt_round: 0.60, stop_hunt_normal: 0.45, absorption: 0.30, fr_trap_long_extreme: 0.40, fr_trap_long_high: 0.25, fr_trap_short_extreme: 0.45, fr_trap_short_elevated: 0.25, lsr_65pct: 0.35, lsr_60pct: 0.20, lsr_35pct: 0.35, lsr_40pct: 0.20, oi_up_oi_down: 0.30, oi_down_oi_down: 0.20, oi_up_oi_up: 0.15, oi_down_oi_up: 0.15, retail_fomo: 0.35, retail_panic: 0.40, retail_chase: 0.20, retail_despair: 0.25, post_flush: 0.15, bear_trap_fear_bonus: 0.30, bull_trap_greed_bonus: 0.30 },
    hard_limits: { max_risk_per_trade: 0.08, max_drawdown: 0.20, max_leverage: 12, min_entry_threshold: 0.40, max_weight_delta_per_update: 0.15 },
    evolve: { enabled: true, min_trades_for_analysis: 10, poor_wr_threshold: 0.50, interval_ms: 21600000, last_evolved_at: null },
    instruments: [
      { id: 'ETH-USDT-SWAP', active: true },
      { id: 'SOL-USDT-SWAP', active: true },
      { id: 'AVAX-USDT-SWAP', active: true }
    ],
    session_rules: {
      asian:  { max_leverage: 8,  size_multiplier: 0.8 },
      london: { max_leverage: 12, size_multiplier: 1.0 },
      ny:     { max_leverage: 10, size_multiplier: 0.9 }
    },
    ai: {
      model_tier: { fast: 'cheapest', smart: 'best_non_opus' },
      model_resolved: { fast: null, smart: null, resolved_at: null },
      model_overrides: { fast: null, smart: null }
    },
    sanity: {
      check_interval_ms: 86400000,
      last_checked_at: null,
      alert_thresholds: { wr_floor_20trades: 0.35, consecutive_sl: 4, version_bumps_per_day: 3, journal_gap_hours: 2 }
    }
  };
}

function validateParams(p) {
  const h = p.hard_limits || {};
  const r = p.risk || {};
  const e = p.entry || {};
  if ((r.risk_per_trade_lab || 0) > (h.max_risk_per_trade || 0.08))
    r.risk_per_trade_lab = h.max_risk_per_trade || 0.08;
  if ((r.max_drawdown_lab || 0) > (h.max_drawdown || 0.20))
    r.max_drawdown_lab = h.max_drawdown || 0.20;
  if ((r.max_leverage_lab || 0) > (h.max_leverage || 12))
    r.max_leverage_lab = h.max_leverage || 12;
  if ((e.threshold_lab || 0) < (h.min_entry_threshold || 0.35))
    e.threshold_lab = h.min_entry_threshold || 0.35;
  const w = p.signal_weights || {};
  const maxW = 2.0;
  for (const [k, v] of Object.entries(w)) {
    if (typeof v === 'number') {
      if (v > maxW) w[k] = maxW;
      if (v < -maxW) w[k] = -maxW;
    }
  }
  return p;
}

function updatePerformance(instId, dir, upl, pnlPct, reasons, fg, scoreBreakdown) {
  try {
    let perf = { version: 1, by_signal: {}, by_instrument: {}, by_session: {}, trades: [] };
    if (existsSync(PERF_FILE)) {
      try { perf = JSON.parse(readFileSync(PERF_FILE, 'utf-8')); } catch {}
    }
    const won = pnlPct > 0;
    const hour = new Date().getUTCHours();
    const session = hour >= 0 && hour < 8 ? 'asian' : hour >= 8 && hour < 13 ? 'london' : 'ny';

    if (!perf.by_instrument[instId]) perf.by_instrument[instId] = { wins: 0, losses: 0, total_pnl: 0 };
    const bi = perf.by_instrument[instId];
    won ? bi.wins++ : bi.losses++;
    bi.total_pnl += pnlPct;
    bi.wr = bi.wins / (bi.wins + bi.losses);

    if (!perf.by_session[session]) perf.by_session[session] = { wins: 0, losses: 0 };
    const bs = perf.by_session[session];
    won ? bs.wins++ : bs.losses++;
    bs.wr = bs.wins / (bs.wins + bs.losses);

    const signalTypes = [
      'LiqSweep', 'FVG', 'BullTrap', 'BearTrap', 'Wyckoff', 'UTAD', 'StopHunt',
      'Absorption', 'MACD', 'RSI', 'BB', 'FRtrap', 'LSR', 'OI', 'Psy'
    ];
    for (const sig of signalTypes) {
      if (reasons.some(r => r.includes(sig))) {
        if (!perf.by_signal[sig]) perf.by_signal[sig] = { wins: 0, losses: 0 };
        const bs2 = perf.by_signal[sig];
        won ? bs2.wins++ : bs2.losses++;
        bs2.wr = bs2.wins / (bs2.wins + bs2.losses);
        bs2.count = bs2.wins + bs2.losses;
      }
    }

    perf.trades.push({ ts: new Date().toISOString(), instId, dir, pnlPct, won, session,
      fg, reasons: reasons.slice(0, 5), scoreBreakdown: scoreBreakdown || null });
    if (perf.trades.length > 200) perf.trades = perf.trades.slice(-200);

    writeFileSync(PERF_FILE, JSON.stringify(perf, null, 2));
  } catch (e) { console.error('perf update err:', e.message); }
}

async function claudeReasoning(instId, score, sig, m, perf, recentTrades, params) {
  const CLAUDE_TOKEN = loadClaudeToken();
  if (!CLAUDE_TOKEN) return null;

  const perfSummary = Object.entries(perf.by_signal || {})
    .filter(([, v]) => v.count >= 3)
    .map(([k, v]) => `${k}:wr=${(v.wr*100).toFixed(0)}%(${v.count}t)`)
    .join(', ');

  const recentStr = recentTrades.slice(-5).map(t =>
    `${t.instId} ${t.dir} ${t.won?'W':'L'} ${(t.pnlPct*100).toFixed(1)}%`
  ).join(', ');

  const prompt = `OKX Lab Trade Decision — Ambiguous Zone
Instrument: ${instId} | Score: ${score.toFixed(2)} | Direction: ${sig.direction||'none'}
Signals: ${sig.reasons.slice(0,6).join(' | ')}
4H:${m.trend4h} RSI4:${m.r4.toFixed(0)} MACD:${m.macd4.hist>0?'↑':'↓'} FR:${m.fr.toFixed(3)}%
F&G: ${sig.reasons.find(r=>r.includes('FG'))||'?'}
Recent 5 trades: ${recentStr||'none yet'}
Signal WR stats: ${perfSummary||'insufficient data'}
Lab threshold: 0.45. This score is ${score.toFixed(2)} — in ambiguous zone.
Reply JSON only: {"action":"enter"|"skip","reasoning":"<20 words>","confidence":"low"|"medium"}`;

  return new Promise(resolve => {
    const body = JSON.stringify({
      model: params?.ai?.model_resolved?.fast || 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_TOKEN,
        'anthropic-version': '2023-06-01'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          const text = r.content?.[0]?.text || '';
          const m2 = text.match(/\{[\s\S]*\}/);
          if (m2) { resolve(JSON.parse(m2[0])); return; }
        } catch {}
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

async function selfEvolve(params, state) {
  if (!params.evolve?.enabled) return;
  const lastEvolved = params.evolve.last_evolved_at ? new Date(params.evolve.last_evolved_at).getTime() : 0;
  if (Date.now() - lastEvolved < (params.evolve.interval_ms || 21600000)) return;

  console.log('[LAB EVOLVE] Starting self-evolution analysis...');

  let perf = { by_signal: {}, by_instrument: {}, by_session: {}, trades: [] };
  try { if (existsSync(PERF_FILE)) perf = JSON.parse(readFileSync(PERF_FILE, 'utf-8')); } catch {}

  const totalTrades = perf.trades.length;
  if (totalTrades < (params.evolve.min_trades_for_analysis || 10)) {
    console.log(`[LAB EVOLVE] Only ${totalTrades} trades — need ${params.evolve.min_trades_for_analysis}. Skipping.`);
    return;
  }

  const CLAUDE_TOKEN = loadClaudeToken();
  if (!CLAUDE_TOKEN) { console.log('[LAB EVOLVE] No Claude token'); return; }

  // Build structured prompt (~1000 tokens max)
  const signalStats = Object.entries(perf.by_signal)
    .filter(([, v]) => (v.wins + v.losses) >= 5)
    .map(([k, v]) => `${k}:wr=${(v.wr*100).toFixed(0)}%,n=${v.wins+v.losses}`)
    .join(' | ');

  const instrStats = Object.entries(perf.by_instrument)
    .map(([k, v]) => `${k.split('-')[0]}:wr=${(v.wr*100).toFixed(0)}%,pnl=${(v.total_pnl*100).toFixed(1)}%`)
    .join(' | ');

  const sessionStats = Object.entries(perf.by_session)
    .map(([k, v]) => `${k}:wr=${(v.wr*100).toFixed(0)}%,n=${v.wins+v.losses}`)
    .join(' | ');

  const last10WR = (() => {
    const t = perf.trades.slice(-10);
    return t.length ? (t.filter(x => x.won).length / t.length * 100).toFixed(0) + '%' : 'n/a';
  })();

  const versionHistory = (params._version_history || []).slice(-3)
    .map(h => `v${h.version}: ${h.reason} (${h.ts?.slice(0,10)||'?'})`)
    .join('; ');

  const currentParams = {
    entry: params.entry,
    risk: { risk_per_trade_lab: params.risk?.risk_per_trade_lab, max_leverage_lab: params.risk?.max_leverage_lab },
    signal_weights: params.signal_weights,
    trailing_sl_lab: params.trailing_sl_lab,
    leverage_tiers_lab: params.leverage_tiers_lab,
    instruments: params.instruments,
    session_rules: params.session_rules,
    evolve: { interval_ms: params.evolve?.interval_ms }
  };

  const systemPrompt = `You are NanoClaw's evolution engine for an OKX crypto futures LAB trading bot (data collection mode).
You analyze trading performance and suggest parameter updates.
RULES:
- Signal weight changes: max ±0.15 per update, must stay in [-2.0, 2.0]
- Only adjust signals with 10+ trades AND WR < poor_wr_threshold
- May suggest: entry thresholds (floor 0.35), TP%, initial SL%, trailing SL breakpoints, leverage tiers, evolve interval, ambiguous zone, session_rules leverage caps, instrument active flags (deactivate if WR<0.45 over 15+ trades)
- DO NOT touch: hard_limits, risk_per_trade_lab (>0.08), max_leverage_lab (>12)
- Be conservative. Only change what has clear statistical evidence.
Return JSON only — no prose.`;

  const userPrompt = `PERFORMANCE (${totalTrades} total trades, last10WR=${last10WR}):
Signals: ${signalStats || 'insufficient data'}
Instruments: ${instrStats || 'no data'}
Sessions: ${sessionStats || 'no data'}

CURRENT PARAMS:
${JSON.stringify(currentParams)}

LAST 3 CHANGES: ${versionHistory || 'none yet'}

Return JSON:
{
  "should_update": true/false,
  "reason": "<30 words max>",
  "weight_changes": { "signal_name": new_value },
  "param_changes": { "entry.threshold_lab": val, "entry.tp_lab": val, "session_rules.asian.max_leverage": val, "instruments.ETH-USDT-SWAP.active": true/false, "evolve.interval_ms": val },
  "bot": "lab"
}`;

  const smartModel = params?.ai?.model_resolved?.smart || 'claude-haiku-4-5';
  const result = await new Promise(resolve => {
    const body = JSON.stringify({
      model: smartModel,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_TOKEN, 'anthropic-version': '2023-06-01' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { const r = JSON.parse(d); const text = r.content?.[0]?.text || ''; const m = text.match(/\{[\s\S]*\}/); if (m) { resolve(JSON.parse(m[0])); return; } } catch {}
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });

  if (!result) { console.log('[LAB EVOLVE] No valid response from Claude'); return; }

  if (!result.should_update) {
    console.log(`[LAB EVOLVE] No changes needed: ${result.reason}`);
    params.evolve.last_evolved_at = new Date().toISOString();
    writeFileSync(PARAMS_FILE, JSON.stringify(params, null, 2));
    return;
  }

  const maxDelta = params.hard_limits?.max_weight_delta_per_update || 0.15;
  const applied = {};

  // Apply weight changes
  for (const [key, newVal] of Object.entries(result.weight_changes || {})) {
    if (!(key in params.signal_weights)) continue;
    const oldVal = params.signal_weights[key];
    const clamped = parseFloat((oldVal + Math.max(-maxDelta, Math.min(maxDelta, newVal - oldVal))).toFixed(3));
    params.signal_weights[key] = clamped;
    applied[`w.${key}`] = `${oldVal}→${clamped}`;
  }

  // Apply structural param changes
  for (const [path, val] of Object.entries(result.param_changes || {})) {
    const parts = path.split('.');
    // Hard limit guards
    if (path === 'entry.threshold_lab' && val < 0.35) continue;
    if (path === 'risk.risk_per_trade_lab' && val > 0.08) continue;
    if (path === 'risk.max_leverage_lab' && val > 12) continue;
    // Navigate and set
    try {
      if (parts[0] === 'instruments' && parts.length === 3) {
        const inst = (params.instruments || []).find(x => x.id === parts[1]);
        if (inst) { const old = inst[parts[2]]; inst[parts[2]] = val; applied[path] = `${old}→${val}`; }
      } else if (parts[0] === 'session_rules' && parts.length === 3) {
        if (!params.session_rules) params.session_rules = {};
        if (!params.session_rules[parts[1]]) params.session_rules[parts[1]] = {};
        const old = params.session_rules[parts[1]][parts[2]];
        params.session_rules[parts[1]][parts[2]] = val;
        applied[path] = `${old}→${val}`;
      } else if (parts.length === 2 && params[parts[0]]) {
        const old = params[parts[0]][parts[1]];
        params[parts[0]][parts[1]] = val;
        applied[path] = `${old}→${val}`;
      }
    } catch {}
  }

  if (Object.keys(applied).length === 0) {
    console.log('[LAB EVOLVE] No valid changes to apply');
    params.evolve.last_evolved_at = new Date().toISOString();
    writeFileSync(PARAMS_FILE, JSON.stringify(params, null, 2));
    return;
  }

  // Version bump + history
  params.version = (params.version || 0) + 1;
  params.update_reason = result.reason;
  params.updated_at = new Date().toISOString();
  params.evolve.last_evolved_at = params.updated_at;
  if (!params._version_history) params._version_history = [];
  params._version_history.push({ version: params.version, reason: result.reason, ts: params.updated_at, changes: applied });
  if (params._version_history.length > 20) params._version_history = params._version_history.slice(-20);

  // Track version bumps for sanity check
  if (!state.versionBumps) state.versionBumps = [];
  state.versionBumps.push(params.updated_at);
  state.versionBumps = state.versionBumps.filter(t => Date.now() - new Date(t).getTime() < 86400000);

  validateParams(params);
  writeFileSync(PARAMS_FILE, JSON.stringify(params, null, 2));

  const changeStr = Object.entries(applied).map(([k, v]) => `${k}: ${v}`).join('\n');
  console.log(`[LAB EVOLVE] Updated params v${params.version}:\n${changeStr}`);
  await tg(`*[LAB EVOLVE] Params v${params.version}*\n${result.reason}\n${changeStr}`);
}

async function resolveModels(params) {
  const ai = params.ai || {};
  const resolved = ai.model_resolved || {};
  const resolvedAt = resolved.resolved_at ? new Date(resolved.resolved_at).getTime() : 0;
  if (Date.now() - resolvedAt < 86400000) return; // 24h cache

  const CLAUDE_TOKEN = loadClaudeToken();
  if (!CLAUDE_TOKEN) return;

  const modelsList = await new Promise(resolve => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/models', method: 'GET',
      headers: { 'x-api-key': CLAUDE_TOKEN, 'anthropic-version': '2023-06-01' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });

  if (!modelsList?.data) { console.log('[AI] Model discovery failed'); return; }

  const overrides = (params.ai || {}).model_overrides || {};
  const modelIds = modelsList.data.map(m => m.id);
  // Fast = cheapest = haiku variant
  const fastModel = overrides.fast || modelIds.find(m => m.includes('haiku')) || 'claude-haiku-4-5';
  // Smart = best non-opus = sonnet
  const smartModel = overrides.smart || modelIds.find(m => m.includes('sonnet-4')) || 'claude-sonnet-4-6';

  if (!params.ai) params.ai = {};
  params.ai.model_resolved = { fast: fastModel, smart: smartModel, resolved_at: new Date().toISOString() };
  writeFileSync(PARAMS_FILE, JSON.stringify(params, null, 2));
  console.log(`[AI] Models: fast=${fastModel} smart=${smartModel}`);
}

async function sanityCheck(params, state) {
  const sanity = params.sanity || {};
  const lastChecked = sanity.last_checked_at ? new Date(sanity.last_checked_at).getTime() : 0;
  if (Date.now() - lastChecked < (sanity.check_interval_ms || 86400000)) return;

  let perf = { trades: [] };
  try { if (existsSync(PERF_FILE)) perf = JSON.parse(readFileSync(PERF_FILE, 'utf-8')); } catch {}

  const issues = [];
  const th = sanity.alert_thresholds || {};

  // WR floor over last 20 trades
  const last20 = perf.trades.slice(-20);
  if (last20.length >= 20) {
    const wr = last20.filter(t => t.won).length / 20;
    if (wr < (th.wr_floor_20trades || 0.35)) issues.push(`WR=${(wr*100).toFixed(0)}% over last 20 (floor:35%)`);
  }

  // Consecutive SL hits
  const consec = th.consecutive_sl || 4;
  const tail = perf.trades.slice(-consec);
  if (tail.length >= consec && tail.every(t => !t.won)) issues.push(`${consec} consecutive losses`);

  // Version bumps per day
  const dayAgo = Date.now() - 86400000;
  const bumps = (state.versionBumps || []).filter(t => new Date(t).getTime() > dayAgo);
  if (bumps.length > (th.version_bumps_per_day || 3)) issues.push(`${bumps.length} evolve bumps in 24h`);

  // Journal gap
  try {
    if (existsSync(JOURNAL_FILE_NANOCLAW) && perf.trades.length > 5) {
      const lines = readFileSync(JOURNAL_FILE_NANOCLAW, 'utf-8').trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]);
        const lastTs = last.ts_close || last.ts || last.ts_open;
        const gapH = (Date.now() - new Date(lastTs).getTime()) / 3600000;
        if (gapH > (th.journal_gap_hours || 2)) issues.push(`Journal gap: ${gapH.toFixed(1)}h`);
      }
    }
  } catch {}

  if (!params.sanity) params.sanity = {};
  params.sanity.last_checked_at = new Date().toISOString();

  if (issues.length === 0) {
    console.log('[SANITY] All checks passed');
    writeFileSync(PARAMS_FILE, JSON.stringify(params, null, 2));
    return;
  }

  console.log(`[SANITY] ISSUES:\n${issues.join('\n')}`);
  params.evolve.enabled = false;
  writeFileSync(PARAMS_FILE, JSON.stringify(params, null, 2));
  await tg(`⚠️ *[SANITY FAILED]*\n${issues.map(i=>`• ${i}`).join('\n')}\nEvolution disabled. Review required.`);
}

// ════════════════════════════════════════════════════════════════════════════
// END ADAPTIVE LAYER
// ════════════════════════════════════════════════════════════════════════════

// ── Conflict Score — multi-timeframe / macro disagreement detector ────────────
// Returns { level: 'low'|'medium'|'high', reasons: string[], penalty: number }
// Called inside generateSignal() AFTER direction is resolved, so we need the
// tentative direction (sign of score before final threshold check).
function computeConflictScore(m, tentativeDir, btcTrend, fg) {
  const conflicts = [];   // each entry: { reason: string, weight: number }

  if (tentativeDir === null) return { level: 'low', reasons: [], penalty: 0, count: 0 };

  const isLong  = tentativeDir === 'long';
  const isShort = tentativeDir === 'short';

  // ── MAJOR (weight 2) ───────────────────────────────────────────────────────
  // 4H vs 1D trend direct disagreement
  const daily4hDisagree =
    (m.trend4h === 'BULL' && !m.dailyBull) ||
    (m.trend4h === 'BEAR' &&  m.dailyBull);
  if (daily4hDisagree) {
    const label = m.trend4h === 'BULL' ? '4H:BULL vs 1D:BEAR' : '4H:BEAR vs 1D:BULL';
    conflicts.push({ reason: label, weight: 2 });
  }

  // ── MINOR (weight 1) ───────────────────────────────────────────────────────
  // RSI 4H overbought while entering LONG
  if (isLong  && m.r4 > 65) conflicts.push({ reason: `RSI4H:${m.r4.toFixed(0)}>65_vs_LONG`,  weight: 1 });
  if (isShort && m.r4 < 35) conflicts.push({ reason: `RSI4H:${m.r4.toFixed(0)}<35_vs_SHORT`, weight: 1 });

  // RSI Daily overbought/oversold vs direction
  if (isLong  && m.rd > 70) conflicts.push({ reason: `RSI1D:${m.rd.toFixed(0)}>70_vs_LONG`,  weight: 1 });
  if (isShort && m.rd < 30) conflicts.push({ reason: `RSI1D:${m.rd.toFixed(0)}<30_vs_SHORT`, weight: 1 });

  // BTC macro bias vs direction
  if (btcTrend?.bias != null) {
    if (isLong  && btcTrend.bias < -0.3) conflicts.push({ reason: `BTC:bearBias(${btcTrend.bias.toFixed(2)})_vs_LONG`,  weight: 1 });
    if (isShort && btcTrend.bias >  0.3) conflicts.push({ reason: `BTC:bullBias(${btcTrend.bias.toFixed(2)})_vs_SHORT`, weight: 1 });
  }

  // Funding rate crowding vs direction
  if (isLong  && m.fundLong)  conflicts.push({ reason: 'FR:crowdedLong_vs_LONG',   weight: 1 });
  if (isShort && m.fundShort) conflicts.push({ reason: 'FR:crowdedShort_vs_SHORT', weight: 1 });

  // F&G extreme vs direction
  if (isLong  && fg?.value > 75) conflicts.push({ reason: `FG:${fg.value}(greed)_vs_LONG`,  weight: 1 });
  if (isShort && fg?.value < 20) conflicts.push({ reason: `FG:${fg.value}(fear)_vs_SHORT`,  weight: 1 });

  const totalWeight = conflicts.reduce((s, c) => s + c.weight, 0);
  const reasons = conflicts.map(c => c.reason);

  let level, penalty;
  if (totalWeight === 0)      { level = 'low';    penalty = 0;     }
  else if (totalWeight <= 2)  { level = 'medium'; penalty = 0;     }
  else                        { level = 'high';   penalty = -0.15; }

  return { level, reasons, penalty, count: conflicts.length, totalWeight };
}

// ── Signal Engine [Lab] (+ Smart Money + BTC Macro + Adaptive Params) ─────────
function generateSignal(m, cycle, fg, macroR, btcTrend, params) {
  let score = 0, reasons = [];
  let sizeM = 1.0;
  const w = params?.signal_weights || {};

  // MACRO RESTRICTIONS
  if (macroR?.action === 'no_new_trade') return { direction:null, leverage:1, score:0, reasons:[`BLOCKED:${macroR.event}`], confidence:'none', sizeM:0 };
  if (macroR?.action === 'half_size') { sizeM = 0.5; reasons.push(`½sz:${macroR.event}`); }

  // BTC MACRO OVERLAY
  if (btcTrend?.bias) {
    score += btcTrend.bias * (w.btc_trend || 0.6);
    reasons.push(btcTrend.label);
  }

  // CYCLE BIAS
  score += cycle.cycleBias * (w.cycle_bias || 0.8);
  reasons.push(`cycle:${cycle.phase}(${(cycle.cycleBias*(w.cycle_bias||0.8)).toFixed(2)})`);

  // SEASONAL BIAS
  score += cycle.seasonalBias * (w.seasonal_bias || 0.5);
  if (cycle.sep_warning) { score -= 0.2; reasons.push('Sep:rektember!'); }

  // FEAR & GREED SIGNAL
  const fgSig = getFGSignal(fg);
  score += fgSig.bias;
  reasons.push(`FG:${fgSig.label}`);
  if (fg.value <= 15 && m.bearTrend) sizeM = Math.min(sizeM, 0.6);

  // DAILY TREND
  if (m.dailyBull) { score += (w.daily_trend || 0.25); reasons.push('1D:bull'); }
  else             { score -= (w.daily_trend || 0.25); reasons.push('1D:bear'); }

  // 4H TREND
  if (m.trend4h==='BULL')       { score += (w.trend_4h || 0.25); reasons.push('4H:bull'); }
  else if (m.trend4h==='BEAR')  { score -= (w.trend_4h || 0.25); reasons.push('4H:bear'); }

  // RSI MULTI-TF
  if (m.rd < 38)      { score += (w.rsi_daily_os || 0.40); reasons.push(`RSId:${m.rd.toFixed(0)}OS`); }
  else if (m.rd > 70) { score -= Math.abs(w.rsi_daily_ob || 0.35); reasons.push(`RSId:${m.rd.toFixed(0)}OB`); }
  if (m.r4 < 35)      { score += (w.rsi_4h_os || 0.40); reasons.push(`RSI4:${m.r4.toFixed(0)}OS`); }
  else if (m.r4 > 65) { score -= Math.abs(w.rsi_4h_ob || 0.30); reasons.push(`RSI4:${m.r4.toFixed(0)}OB`); }
  if (m.r1 < 30)      { score += (w.rsi_1h_os || 0.25); reasons.push(`RSI1:${m.r1.toFixed(0)}OS`); }
  else if (m.r1 > 70) { score -= Math.abs(w.rsi_1h_ob || 0.20); reasons.push(`RSI1:${m.r1.toFixed(0)}OB`); }

  // RSI DIVERGENCE
  if (m.div4==='bullish') { score += (w.rsi_div_4h || 0.45); reasons.push('4H:bullDiv✓'); }
  if (m.div4==='bearish') { score -= (w.rsi_div_4h || 0.45); reasons.push('4H:bearDiv✓'); }
  if (m.div1==='bullish') { score += (w.rsi_div_1h || 0.20); reasons.push('1H:bullDiv'); }
  if (m.div1==='bearish') { score -= (w.rsi_div_1h || 0.20); reasons.push('1H:bearDiv'); }

  // MACD
  if (m.macd4.hist>0 && m.macd4.hist>m.macd4.prevHist) { score+=(w.macd||0.20); reasons.push('MACD:↑'); }
  else if (m.macd4.hist<0 && m.macd4.hist<m.macd4.prevHist) { score-=(w.macd||0.20); reasons.push('MACD:↓'); }

  // BOLLINGER
  if (m.bbp < 0.05)      { score += (w.bollinger || 0.30); reasons.push('BB:bottom'); }
  else if (m.bbp > 0.95) { score -= (w.bollinger || 0.30); reasons.push('BB:top'); }

  // KEY LEVELS
  if (m.nearLow)  { score += (w.key_level || 0.15); reasons.push('20dLow'); }
  if (m.nearHigh) { score -= (w.key_level || 0.15); reasons.push('20dHigh'); }

  // FUNDING RATE
  if (m.fundLong)  { score -= (w.funding_rate || 0.30); reasons.push(`FR:crowdedL`); }
  if (m.fundShort) { score += (w.funding_rate || 0.30); reasons.push(`FR:crowdedS`); }

  // LIQUIDITY SWEEP
  if (m.liqSweep === 'bullish_sweep') { score += (w.liq_sweep || 0.50); reasons.push('LiqSweep:bull✓✓'); }
  if (m.liqSweep === 'bearish_sweep') { score -= (w.liq_sweep || 0.50); reasons.push('LiqSweep:bear✓✓'); }

  // FVG
  if (m.fvg?.type === 'bullish') { score += (w.fvg || 0.25); reasons.push('FVG:bull'); }
  if (m.fvg?.type === 'bearish') { score -= (w.fvg || 0.25); reasons.push('FVG:bear'); }

  // VOLUME CONFIRM
  const scorePreVol = score;
  let volPenalty = 1.0;
  if (m.vr > 1.8)      { volPenalty = (w.vol_high_mult || 1.25); score *= volPenalty; reasons.push(`vol:${m.vr.toFixed(1)}x`); }
  else if (m.vr < 0.5) { volPenalty = (w.vol_low_mult || 0.80);  score *= volPenalty; reasons.push('vol:low'); }

  // ════════════════════════════════════════════════
  // SMART MONEY CONCEPTS
  // ════════════════════════════════════════════════
  const scorePreSMC = score;
  const smc = m.smc || {};

  // WYCKOFF SPRING
  if (smc.wyckoff) {
    const wy = smc.wyckoff;
    const wyBias = wy.strength === 'strong' ? (w.smc_wyckoff_strong || 0.75)
                 : wy.strength === 'medium' ? (w.smc_wyckoff_medium || 0.55)
                 : (w.smc_wyckoff_weak || 0.35);
    score += wyBias;
    reasons.push(`Wyckoff:Spring(${wy.strength})[${wy.signals.join(',')}]`);
    if (wy.strength === 'strong') sizeM = Math.min(sizeM * 1.3, 1.5);
  }

  // UTAD
  if (smc.utad) {
    const u = smc.utad;
    const utadBias = -(u.strength === 'strong' ? (w.smc_utad_strong || 0.70) : (w.smc_utad_weak || 0.40));
    score += utadBias;
    reasons.push(`UTAD(${u.strength})[${u.signals.join(',')}]`);
    if (u.strength === 'strong') sizeM = Math.min(sizeM * 1.2, 1.5);
  }

  // BULL TRAP
  if (smc.bullTrap) {
    const bt = smc.bullTrap;
    const btBias = -(bt.strength === 'strong' ? (w.smc_bull_trap_strong || 0.65) : (w.smc_bull_trap_weak || 0.35));
    score += btBias;
    reasons.push(`BullTrap(${bt.strength})[${bt.signals.join(',')}]`);
    if (bt.strength === 'strong' && fg.value > 60) {
      score -= (w.bull_trap_greed_bonus || 0.30);
      reasons.push('BullTrap+HighFG→DistributionConfirmed');
    }
  }

  // BEAR TRAP
  if (smc.bearTrap) {
    const bt = smc.bearTrap;
    const btBias = bt.strength === 'strong' ? (w.smc_bear_trap_strong || 0.65) : (w.smc_bear_trap_weak || 0.35);
    score += btBias;
    reasons.push(`BearTrap(${bt.strength})[${bt.signals.join(',')}]`);
    if (bt.strength === 'strong' && fg.value < 25) {
      score += (w.bear_trap_fear_bonus || 0.30);
      reasons.push('BearTrap+ExtremeFear→AccumulationConfirmed');
    }
  }

  // STOP HUNT
  if (smc.stopHunt) {
    const sh = smc.stopHunt;
    const shBias = sh.nearRound ? (w.stop_hunt_round || 0.60) : (w.stop_hunt_normal || 0.45);
    const shDir = sh.type.includes('bullish') ? +shBias : -shBias;
    score += shDir;
    const rn = sh.nearRound ? `+RoundNum($${sh.nearestRound})` : '';
    reasons.push(`StopHunt:${sh.type.replace('stop_hunt_','')}${rn}`);
  }

  // ABSORPTION
  if (smc.absorption && smc.absorption.context !== 'neutral') {
    const absBias = smc.absorption.context === 'accumulation' ? (w.absorption || 0.30) : -(w.absorption || 0.30);
    score += absBias;
    reasons.push(`Absorption:${smc.absorption.context}(${smc.absorption.volRatio})`);
  }

  // FUNDING RATE TRAP
  if (smc.fundingTrap) {
    const ft = analyzeFundingTrap(m.fr, m.price, fg);
    if (ft) {
      let ftBias = ft.bias;
      if (ft.type === 'long_crowded') {
        ftBias = -(ft.severity === 'extreme' ? (w.fr_trap_long_extreme || 0.40) : (w.fr_trap_long_high || 0.25));
      } else if (ft.type === 'short_crowded') {
        ftBias = ft.severity === 'extreme' ? (w.fr_trap_short_extreme || 0.45) : (w.fr_trap_short_elevated || 0.25);
      }
      score += ftBias;
      reasons.push(`FRtrap:${ft.type}(${ft.fr})${ft.severity==='extreme'?'!!':''}`);
    }
  }

  // LONG/SHORT RATIO
  if (smc.lsr && smc.lsr.bias !== 0) {
    score += smc.lsr.bias;
    reasons.push(smc.lsr.label);
  }

  // OI DIVERGENCE
  if (smc.oiDiv && smc.oiDiv.bias !== 0) {
    score += smc.oiDiv.bias;
    reasons.push(smc.oiDiv.label);
  }

  // RETAIL PSYCHOLOGY COMPOSITE
  const retailPsy = analyzeRetailPsychology(fg, cycle, m);
  if (retailPsy.bias !== 0) {
    score += retailPsy.bias;
    retailPsy.signals.slice(0,2).forEach(s => reasons.push(`Psy:${s.slice(0,40)}`));
  }

  // TRAP CANCELLATION LOGIC
  const scorePreKnockdown = score;
  let smcKnockdown = null;
  if (smc.bullTrap?.strength === 'strong' && score > 0.6) {
    smcKnockdown = 'bullTrap_strong';
    reasons.push('BullTrap:cancelling_long_signal');
    score = Math.min(score, 0.4);
  }
  if (smc.bearTrap?.strength === 'strong' && score < -0.6) {
    smcKnockdown = smcKnockdown ? `${smcKnockdown}+bearTrap_strong` : 'bearTrap_strong';
    reasons.push('BearTrap:cancelling_short_signal');
    score = Math.max(score, -0.4);
  }

  // SCORE FLOOR — preserve data quality for selfEvolve
  if (scorePreSMC > 0.10 && score > 0 && score < 0.10) {
    score = 0.10;
    if (!smcKnockdown) reasons.push('score:floor+0.10(SMC_drag)');
  }
  if (scorePreSMC < -0.10 && score < 0 && score > -0.10) {
    score = -0.10;
    if (!smcKnockdown) reasons.push('score:floor-0.10(SMC_drag)');
  }

  // ── FINAL DECISION [LAB: lower threshold, max lev 5x] ──
  const entryThresh = params?.entry?.threshold_lab || 0.45;
  const ltLab = params?.leverage_tiers_lab || {};
  const labMaxLev = params?.risk?.max_leverage_lab || LAB_MAX_LEV;
  let direction = null, leverage = 1, confidence = 'low';
  if (score >= entryThresh) {
    direction = 'long';
    leverage = Math.min(score>=(ltLab.l5||1.10)?5 : score>=(ltLab.l4||0.90)?4 : score>=(ltLab.l3||0.70)?3 : 2, labMaxLev);
    confidence = score>=0.75?'medium':'low_lab';
  } else if (score <= -entryThresh) {
    direction = 'short';
    leverage = Math.min(score<=-(ltLab.l5||1.10)?5 : score<=-(ltLab.l4||0.90)?4 : score<=-(ltLab.l3||0.70)?3 : 2, labMaxLev);
    confidence = score<=-0.75?'medium':'low_lab';
  }

  // LAB: Allow shorts even in extreme fear (data collection — mark it)
  if (direction === 'short' && fg.value <= 20) {
    reasons.push('SHORT_in_fear:lab_mode');
  }

  // ── CONFLICT SCORE ──────────────────────────────────────────────────────────
  const tentativeDir = score >= (params?.entry?.threshold_lab || 0.45) ? 'long'
                     : score <= -(params?.entry?.threshold_lab || 0.45) ? 'short'
                     : (score > 0 ? 'long' : score < 0 ? 'short' : null);
  const conflict = computeConflictScore(m, tentativeDir, btcTrend, fg);

  // Apply penalty for HIGH conflict (reduces score, may flip below threshold)
  if (conflict.level === 'high') {
    const penaltyAmt = Math.abs(conflict.penalty) * Math.abs(score);
    score += score > 0 ? -penaltyAmt : +penaltyAmt;
    reasons.push(`conflict:HIGH(${conflict.count}x)→penalty`);
    // Re-evaluate direction after penalty
    const entryThreshC = params?.entry?.threshold_lab || 0.45;
    if (direction === 'long'  && score <  entryThreshC) { direction = null; confidence = 'none'; }
    if (direction === 'short' && score > -entryThreshC) { direction = null; confidence = 'none'; }
  }

  const scoreBreakdown = {
    score_pre_vol:       +scorePreVol.toFixed(4),
    vol_penalty:         volPenalty,
    score_pre_smc:       +scorePreSMC.toFixed(4),
    score_pre_knockdown: smcKnockdown ? +scorePreKnockdown.toFixed(4) : null,
    smc_knockdown:       smcKnockdown,
    score_final:         +score.toFixed(4),
    conflict_level:      conflict.level,
    conflict_weight:     conflict.totalWeight
  };

  return { direction, leverage, score, reasons: reasons.slice(0,12), confidence, sizeM, scoreBreakdown, conflict };
}

// ── Telegram ──────────────────────────────────────────────────────────────────
async function tg(msg) {
  const botToken = '7986090023:AAFhg8IaukAMN5WGlyvCKgSlsYAcbdDiEP4';
  const chatId   = '1275624537';
  const body = JSON.stringify({chat_id:chatId, text:`*[OKX Lab Bot]*\n${msg}`, parse_mode:'Markdown'});
  return new Promise(resolve => {
    const req = https.request({hostname:'api.telegram.org',path:`/bot${botToken}/sendMessage`,method:'POST',
      headers:{'Content-Type':'application/json'}}, res => { res.on('data',()=>{}); res.on('end',resolve); });
    req.on('error', ()=>resolve()); req.write(body); req.end();
  });
}

async function tgTo(chatId, msg) {
  const botToken = '7986090023:AAFhg8IaukAMN5WGlyvCKgSlsYAcbdDiEP4';
  const body = JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' });
  return new Promise(resolve => {
    const req = https.request({ hostname: 'api.telegram.org', path: `/bot${botToken}/sendMessage`, method: 'POST',
      headers: { 'Content-Type': 'application/json' } }, res => { res.on('data', ()=>{}); res.on('end', resolve); });
    req.on('error', () => resolve()); req.write(body); req.end();
  });
}

function formatParamsMsg(params) {
  const r = params.risk || {}, e = params.entry || {}, ev = params.evolve || {};
  const topW = Object.entries(params.signal_weights || {}).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,5)
    .map(([k,v])=>`${k}:${v}`).join(', ');
  return `*[LAB Params v${params.version}]* ${params.update_reason||''}
Risk: ${(r.risk_per_trade_lab*100).toFixed(0)}% | MaxPos:${r.max_positions_lab} | MaxLev:${r.max_leverage_lab}x
Entry: thresh=${e.threshold_lab} | TP=${(e.tp_lab*100).toFixed(0)}% | SL=${(e.initial_sl_lab*100).toFixed(0)}%
Evolve: ${ev.enabled?'ON':'OFF'} | interval=${(ev.interval_ms/3600000).toFixed(0)}h
Top signals: ${topW}
Updated: ${params.updated_at?.slice(0,16)||'never'}`;
}

function formatHealthMsg(state, perf) {
  const trades = perf.trades || [];
  const last10 = trades.slice(-10);
  const wr10 = last10.length ? (last10.filter(t=>t.won).length/last10.length*100).toFixed(0)+'%' : 'n/a';
  const total = trades.length;
  const allWR = total ? (trades.filter(t=>t.won).length/total*100).toFixed(0)+'%' : 'n/a';
  const byInst = Object.entries(perf.by_instrument||{})
    .map(([k,v])=>`${k.split('-')[0]}:${(v.wr*100).toFixed(0)}%(${v.wins+v.losses}t)`).join(' ');
  return `*[LAB Health]*
Trades: ${total} total | WR: ${allWR} (last10: ${wr10})
By instrument: ${byInst||'no data'}
Open positions tracked: ${Object.keys(state.trailPeak||{}).length}
Peak equity: $${state.peakEquity?.toFixed(2)||'?'}`;
}

function formatWhyMsg(sym, perf) {
  if (!sym) return '*Usage:* /why ETH';
  const key = sym.includes('-') ? sym : `${sym}-USDT-SWAP`;
  const trades = (perf.trades||[]).filter(t=>t.instId===key).slice(-3);
  if (!trades.length) return `No recent trades for ${key}`;
  const lines = trades.map(t => {
    const sb = t.scoreBreakdown;
    let scoreStr = '';
    if (sb) {
      if (sb.smc_knockdown) {
        scoreStr = `\n  Score: ${sb.score_pre_smc}(pre-SMC) → 🚫${sb.smc_knockdown} → ${sb.score_final}(final)`;
        if (sb.vol_penalty !== 1.0) scoreStr += ` [vol×${sb.vol_penalty}]`;
      } else if (sb.vol_penalty !== 1.0) {
        scoreStr = `\n  Score: ${sb.score_pre_vol}(raw) ×${sb.vol_penalty}vol → ${sb.score_final}(final)`;
      } else {
        scoreStr = `\n  Score: ${sb.score_final}`;
      }
    }
    const reasonStr = (t.reasons||[]).slice(0,3).join(' | ');
    return `${t.ts?.slice(0,16)||'?'} ${t.dir} ${t.won?'✅':'❌'} ${(t.pnlPct*100).toFixed(1)}%${scoreStr}\n  ${reasonStr}`;
  }).join('\n');
  return `*[LAB] Last trades for ${key}:*\n${lines}`;
}

async function handleTelegramCommands(params, state, perf) {
  const botToken = '7986090023:AAFhg8IaukAMN5WGlyvCKgSlsYAcbdDiEP4';
  const offset = state.tgOffset || 0;
  const updates = await new Promise(resolve => {
    const req = https.request({ hostname: 'api.telegram.org',
      path: `/bot${botToken}/getUpdates?offset=${offset}&limit=10&timeout=0`, method: 'GET' },
      res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve(null)} }); });
    req.on('error', ()=>resolve(null));
    req.setTimeout(5000, ()=>{ req.destroy(); resolve(null); });
    req.end();
  });
  if (!updates?.ok || !updates.result?.length) return;
  for (const upd of updates.result) {
    state.tgOffset = (upd.update_id || 0) + 1;
    const text = (upd.message?.text || '').trim();
    const chatId = upd.message?.chat?.id;
    if (!text || !chatId) continue;
    if (text === '/params') await tgTo(chatId, formatParamsMsg(params));
    else if (text === '/health') await tgTo(chatId, formatHealthMsg(state, perf));
    else if (text.toLowerCase().startsWith('/why')) await tgTo(chatId, formatWhyMsg(text.split(' ')[1], perf));
  }
}

function startupAudit(params) {
  const issues = [];
  const h = params.hard_limits || {};
  if ((h.max_risk_per_trade||0) > 0.08) issues.push(`hard_limit max_risk=${h.max_risk_per_trade} > 0.08`);
  if ((h.max_leverage||0) > 12) issues.push(`hard_limit max_lev=${h.max_leverage} > 12`);
  if ((h.min_entry_threshold||0) < 0.35) issues.push(`hard_limit min_thresh=${h.min_entry_threshold} < 0.35`);
  const tLab = (params.entry && params.entry.threshold_lab) || 0.45;
  const gap = tLab - (h.min_entry_threshold||0);
  if (gap > 0.15) issues.push("hardlimit minthresh=" + (h.min_entry_threshold||0) + " << threshold_lab=" + tLab + " (gap=" + gap.toFixed(2) + ", max 0.15)");
  const ambLow = params.entry?.ambiguous_zone_low || 0.35;
  const ambHigh = params.entry?.ambiguous_zone_high || 0.65;
  if (ambLow >= ambHigh) issues.push(`Ambiguous zone invalid: ${ambLow} >= ${ambHigh}`);
  const evolveMs = params.evolve?.interval_ms || 21600000;
  if (evolveMs < 3600000) issues.push(`evolve.interval_ms=${evolveMs} < 1h`);
  return issues;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
const params = validateParams(loadParams());
let perf = { by_signal: {}, by_instrument: {}, by_session: {}, trades: [] };
try { if (existsSync(PERF_FILE)) perf = JSON.parse(readFileSync(PERF_FILE, 'utf-8')); } catch {}

// Model auto-discovery (24h cache)
await resolveModels(params);
// Startup self-audit
const auditIssues = startupAudit(params);
if (auditIssues.length > 0) {
  console.log(`[AUDIT] Issues: ${auditIssues.join('; ')}`);
  await tg(`⚠️ *[AUDIT]* ${auditIssues.join('; ')}`);
}

const state = loadState();
const ts = new Date().toISOString();

// Handle Telegram commands
await handleTelegramCommands(params, state, perf);

// Load context
const [cycle, fg, macroR, btcTrend] = await Promise.all([
  Promise.resolve(getCycleContext()),
  getFearGreed(),
  Promise.resolve(getMacroRestriction()),
  getBTCTrend(),
]);

console.log(`\n${'═'.repeat(65)}`);
console.log(`OKX Lab v1 [Active Learning] | ${ts}`);
console.log(`Cycle: ${cycle.phase} | ${cycle.monthsPost}mo post-halving | ${cycle.monthsFromATH}mo from ATH`);
console.log(`Fear&Greed: ${fg.value} (${fg.label}) trend:${fg.trend}`);
console.log(`Seasonal: ${cycle.monthLabel}`);
console.log(`BTC Macro: ${btcTrend.label} | R4:${btcTrend.r4?.toFixed(0)||'?'}`);
if (macroR) console.log(`MACRO: ${macroR.event} → ${macroR.action}`);
console.log(`Params v${params.version} (${params.update_reason})`);

// Balance
const balResp = await apiGet('/api/v5/account/balance');
if (balResp.code !== '0') { console.error('Balance error'); process.exit(1); }
const equity = parseFloat(balResp.data[0].totalEq);
console.log(`Equity: $${equity.toFixed(2)} | Peak: $${state.peakEquity.toFixed(2)}`);
if (equity > state.peakEquity) state.peakEquity = equity;
const dd = (state.peakEquity - equity) / state.peakEquity;
const maxDD = params?.risk?.max_drawdown_lab || MAX_DRAWDOWN;
if (dd > maxDD) {
  const m = `[LAB] DRAWDOWN ${(dd*100).toFixed(1)}% — paused. Peak:$${state.peakEquity.toFixed(2)}`;
  console.log(m); await tg(m); saveState(state); process.exit(0);
}

// Positions
const posR = await apiGet('/api/v5/account/positions');
const openPos = (posR.data||[]).filter(p=>Math.abs(parseFloat(p.pos))>0);
const maxPos = params?.risk?.max_positions_lab || MAX_POSITIONS;
console.log(`Open: ${openPos.length}/${maxPos}\n`);

// ── Manage positions ──────────────────────────────────────────────────────────
if (!state.trailPeak) state.trailPeak = {};
if (!state.lastSL)    state.lastSL = {};
if (!state.openData)  state.openData = {};

const REENTRY_COOLDOWN_MS = params?.risk?.reentry_cooldown_ms || 4 * 3600 * 1000;

for (const pos of openPos) {
  const instId    = pos.instId;
  const upl       = parseFloat(pos.upl);
  const pnlPct    = upl / equity;
  const dir       = parseFloat(pos.pos) > 0 ? 'LONG' : 'SHORT';
  const lever     = parseFloat(pos.lever);
  const entryPrice = parseFloat(pos.avgPx);
  console.log(`[HOLD] ${instId} ${dir} ${lever}x | ${upl>=0?'+':''}$${upl.toFixed(2)} (${(pnlPct*100).toFixed(1)}%)`);

  // ── Trailing SL: update high-water mark ──────────────────────────────────
  if (pnlPct > (state.trailPeak[instId] || 0)) state.trailPeak[instId] = pnlPct;
  const hwm = state.trailPeak[instId] || 0;

  // ── LAB Tiered SL — uses params ──────────────────────────────────────────
  const tsl = params?.trailing_sl_lab || {};
  let slThreshold, slLabel;
  if (hwm >= (tsl.t4_hwm || 0.12)) {
    slThreshold = hwm * (tsl.t4_pct || 0.70);
    slLabel = `Trail${((tsl.t4_pct||0.70)*100).toFixed(0)}%(hwm:${(hwm*100).toFixed(0)}%→SL:${(slThreshold*100).toFixed(0)}%)`;
  } else if (hwm >= (tsl.t3_hwm || 0.08)) {
    slThreshold = Math.max(hwm - (tsl.t3_trail || 0.03), 0.03);
    slLabel = `Trail-${((tsl.t3_trail||0.03)*100).toFixed(0)}%(hwm:${(hwm*100).toFixed(0)}%→SL:${(slThreshold*100).toFixed(0)}%)`;
  } else if (hwm >= (tsl.t2_hwm || 0.04)) {
    slThreshold = tsl.t2_sl || 0.02;
    slLabel = `LockIn+${((tsl.t2_sl||0.02)*100).toFixed(0)}%(hwm:${(hwm*100).toFixed(0)}%)`;
  } else if (hwm >= (tsl.t1_hwm || 0.02)) {
    slThreshold = tsl.t1_sl || 0.00;
    slLabel = `BreakEven(hwm:${(hwm*100).toFixed(0)}%)`;
  } else {
    slThreshold = tsl.t0_sl || -0.04;
    slLabel = `SL${((tsl.t0_sl||-0.04)*100).toFixed(0)}%`;
  }

  // ── Macro tighten ─────────────────────────────────────────────────────────
  const macroTighten = tsl.macro_tighten || -0.02;
  if (macroR?.action === 'half_size' && slThreshold < macroTighten) {
    slThreshold = macroTighten;
    slLabel += `+MacroTighten`;
  }

  const oiPrevHold = pickOiPrev(state, instId);
  const m   = await analyzeMarket(instId, fg, oiPrevHold, params?.risk?.max_leverage_lab || LAB_MAX_LEV);
  if (!m) continue;
  pushOiSample(state, instId, m.oiCurrent);
  const sig = generateSignal(m, cycle, fg, null, btcTrend, params);

  // Log SMC signals for open positions
  const posSmcLog = [
    m.smc?.bullTrap  && `BullTrap(${m.smc.bullTrap.strength})`,
    m.smc?.bearTrap  && `BearTrap(${m.smc.bearTrap.strength})`,
    m.smc?.utad      && `UTAD(${m.smc.utad.strength})`,
    m.smc?.wyckoff   && `Spring(${m.smc.wyckoff.strength})`,
    m.smc?.stopHunt  && `StopHunt:${m.smc.stopHunt.type.includes('bull')?'up':'down'}`,
  ].filter(Boolean).join(' ');
  if (posSmcLog) console.log(`  SMC: ${posSmcLog}`);
  console.log(`  ${slLabel} | hwm:${(hwm*100).toFixed(1)}% cur:${(pnlPct*100).toFixed(1)}%`);

  const tpPct = params?.entry?.tp_lab || 0.06;
  const tp  = pnlPct >= tpPct;
  const sl  = pnlPct <= slThreshold;
  const rev = (dir==='LONG'&&sig.direction==='short'&&sig.confidence!=='low') ||
              (dir==='SHORT'&&sig.direction==='long'&&sig.confidence!=='low');

  if (tp||sl||rev) {
    const reason = tp?`TP+${(tpPct*100).toFixed(0)}%`:sl?`SL[${slLabel}]`:'reversal';
    console.log(`  → EXIT [${reason}]`);
    const closePosSide = dir === 'LONG' ? 'long' : 'short';
    const closeSide    = dir === 'LONG' ? 'sell' : 'buy';
    const r = await apiPost('/api/v5/trade/order',{
      instId, tdMode:'cross', side: closeSide,
      ordType:'market', sz:String(Math.abs(parseFloat(pos.pos))), posSide: closePosSide
    });
    if (r?.code==='0') {
      if (sl) state.lastSL[instId] = { ts, pnlPct, entryPrice, hwm };
      delete state.trailPeak[instId];
      // Performance tracking
      const lastReasons = sig.reasons || [];
      updatePerformance(instId, dir, upl, pnlPct, lastReasons, fg.value);
      // Journal: record closed trade with full context
      journalWrite({ type:'close', instId, dir, upl, pnlPct, hwm, reason,
        fg: fg.value, score: sig.score, smc: Object.keys(m.smc).filter(k=>m.smc[k]) });
      try {
        const od = state.openData?.[instId] || {};
        const hour = new Date().getUTCHours();
        const session = hour>=0&&hour<8?'asian':hour>=8&&hour<13?'london':'ny';
        appendFileSync(JOURNAL_FILE_NANOCLAW, JSON.stringify({
          type: 'close', bot: 'lab',
          ts_open: od.ts_open || null,
          ts_close: ts,
          instrument: instId,
          direction: dir,
          entry: od.entry || entryPrice,
          exit: m?.price || null,
          pnl_pct: pnlPct,
          exit_reason: reason,
          session,
          params_version: params.version,
          score: sig.score,
          primary_signal: (sig.reasons||[])[0] || null,
          signals_fired: sig.reasons || [],
          leverage: lever,
          confidence: od.confidence || null,
          btc_bias: od.btc_bias || null,
          fear_greed: fg.value,
          funding_rate: od.funding_rate || null,
          claude_reasoning: od.claude_reasoning || null,
          score_breakdown: od.score_breakdown || {},
          hwm, upl
        }) + '\n');
        if (state.openData) delete state.openData[instId];
      } catch {}
      await tg(`${upl>=0?'WIN':'LOSS'} *[LAB] ${instId}* ${dir} closed\n${reason}: ${upl>=0?'+':''}$${upl.toFixed(2)} (${(pnlPct*100).toFixed(1)}%)\nHWM:${(hwm*100).toFixed(1)}% | Equity: $${equity.toFixed(2)}`);
      state.trades.push({instId,dir,upl,reason,ts});
    }
  } else {
    // Journal: record hold decision with signal context
    journalWrite({ type:'hold', instId, dir, pnlPct, hwm, slThreshold,
      score: sig.score, fg: fg.value });
    console.log(`  → HOLD (sig:${sig.score.toFixed(2)})`);
  }
}

// ── New entries ───────────────────────────────────────────────────────────────
const posR2  = await apiGet('/api/v5/account/positions');
const openNow = (posR2.data||[]).filter(p=>Math.abs(parseFloat(p.pos))>0);
const openIds = openNow.map(p=>p.instId);

if (true) {
  for (const instId of WATCHLIST.filter(id=>!openIds.includes(id))) {
    const oiPrevScan = pickOiPrev(state, instId);
    const m   = await analyzeMarket(instId, fg, oiPrevScan, params?.risk?.max_leverage_lab || LAB_MAX_LEV);
    if (!m) continue;
    pushOiSample(state, instId, m.oiCurrent);
    const sig = generateSignal(m, cycle, fg, macroR, btcTrend, params);
    const rStr = sig.reasons.slice(0,6).join(' | ');
    // SMC summary display
    const smcLog = [
      m.smc?.wyckoff    && `Spring(${m.smc.wyckoff.strength})`,
      m.smc?.utad       && `UTAD(${m.smc.utad.strength})`,
      m.smc?.bullTrap   && `BullTrap(${m.smc.bullTrap.strength})`,
      m.smc?.bearTrap   && `BearTrap(${m.smc.bearTrap.strength})`,
      m.smc?.stopHunt   && `StopHunt:${m.smc.stopHunt.type.includes('bull')?'up':'down'}`,
      m.smc?.absorption && `Absorb:${m.smc.absorption.context}(${m.smc.absorption.volRatio})`,
      m.lsrLongPct      && `LSR:${(m.lsrLongPct*100).toFixed(0)}%L`,
    ].filter(Boolean).join(' ');
    const conflictTag = sig.conflict?.level === 'high'   ? `⚡conflict=HIGH(${sig.conflict.reasons.slice(0,2).join(', ')})`
                      : sig.conflict?.level === 'medium' ? `⚠ conflict=MED(${sig.conflict.reasons[0]||''})`
                      : '';
    console.log(`[SCAN] ${instId}: $${m.price.toFixed(2)} score=${sig.score.toFixed(2)} → ${sig.direction||'WAIT'} conf=${sig.confidence}${conflictTag ? ' | '+conflictTag : ''}`);
    console.log(`       ${rStr}`);
    if (smcLog) console.log(`       SMC: ${smcLog}`);
    // Journal: log every scan regardless of outcome
    journalWrite({ type:'scan', instId, price: m.price, score: sig.score,
      direction: sig.direction||'none', confidence: sig.confidence,
      fg: fg.value, r4: m.r4.toFixed(0), r1: m.r1.toFixed(0),
      trend4h: m.trend4h, fr: m.fr.toFixed(4),
      smc: Object.keys(m.smc).filter(k=>m.smc[k]).join(','),
      reasons: sig.reasons.join('|'),
      conflict_level: sig.conflict?.level||'low',
      conflict_reasons: sig.conflict?.reasons?.join('|')||'',
      conflict_weight: sig.conflict?.totalWeight||0,
      macro: macroR?.event||null });

    // Ambiguous zone: ask Claude for borderline decisions
    const absScore = Math.abs(sig.score);
    const entryThresh = params?.entry?.threshold_lab || 0.45;
    const ambLow = params?.entry?.ambiguous_zone_low || 0.35;
    const ambHigh = params?.entry?.ambiguous_zone_high || 0.65;
    if (sig.direction && absScore >= ambLow && absScore <= ambHigh && (sig.confidence === 'low_lab' || sig.confidence === 'low')) {
      const reasoning = await claudeReasoning(instId, sig.score, sig, m, perf, perf.trades, params);
      if (reasoning) {
        console.log(`  Claude: ${reasoning.action} (${reasoning.confidence}) — ${reasoning.reasoning}`);
        try {
          appendFileSync(JOURNAL_FILE_NANOCLAW, JSON.stringify({
            type: 'reasoning', bot: 'lab', instId, score: sig.score,
            claude_action: reasoning.action, claude_reasoning: reasoning.reasoning,
            claude_confidence: reasoning.confidence, ts: new Date().toISOString()
          }) + '\n');
        } catch {}
        if (reasoning.action === 'skip') {
          console.log(`  Claude said skip — passing this one`);
          continue;
        }
        if (!state.openData) state.openData = {};
        if (!state.openData[instId]) state.openData[instId] = {};
        state.openData[instId].claude_reasoning = reasoning.reasoning;
      }
    }

    // LAB: allow low_lab confidence (not strict 'medium'/'high')
    if (!sig.direction || sig.confidence==='none') continue;
    // ── Re-entry cooldown ──────────────────────────────────────────────────
    const lastSlData = state.lastSL?.[instId];
    if (lastSlData) {
      const elapsed = Date.now() - new Date(lastSlData.ts).getTime();
      if (elapsed < REENTRY_COOLDOWN_MS) {
        const minsLeft = Math.ceil((REENTRY_COOLDOWN_MS - elapsed) / 60000);
        console.log(`  Re-entry blocked (SL ${Math.floor(elapsed/60000)}min ago, ${minsLeft}min cooldown left | prevSL:${(lastSlData.pnlPct*100).toFixed(1)}%)`);
        continue;
      }
      delete state.lastSL[instId];
    }
    // OKX contract sizes
    const ctUsdVal = instId.startsWith('BTC') ? 0.01*m.price
                   : instId.startsWith('ETH') ? 0.1*m.price
                   : 1*m.price;

    // ── Fix #4: Session rules (lab) ────────────────────────────────────────
    const session = getCurrentSession();
    const sessionRule = params?.session_rules?.[session] || {};
    const sessionMaxLev = sessionRule.max_leverage || 999;
    const sessionSizeMult = sessionRule.size_multiplier || 1.0;

    // ── Universal instrument profile (ATR + liquidity, lab-capped) ─────────
    const profile = m.profile;
    const labMaxLevParam = params?.risk?.max_leverage_lab || LAB_MAX_LEV;
    const maxLevByProfile = profile?.maxLev || labMaxLevParam;
    const minLevNeeded = Math.ceil(ctUsdVal / (equity * 0.8));
    const useLev = Math.min(
      Math.max(sig.leverage, minLevNeeded),
      labMaxLevParam,
      maxLevByProfile,
      sessionMaxLev
    );
    if (useLev !== sig.leverage) {
      console.log(`  [LAB] Leverage: sig=${sig.leverage}x → use=${useLev}x (prof=${maxLevByProfile}x sess=${sessionMaxLev}x)`);
    }

    // ── ATR-based risk-targeted sizing (universal formula) ──────────────────
    const riskPct = params?.risk?.risk_per_trade_lab || RISK_PER_TRADE;
    let sz, slPrice, tpPrice;
    if (profile?.atr && profile?.atrPct) {
      const riskUsd = equity * riskPct * sessionSizeMult * profile.sizeMult * (sig.sizeM || 1);
      const slDistance = profile.k_sl * profile.atr;
      const tpDistance = profile.k_tp * profile.atr;
      const notionalUsd = riskUsd * (m.price / slDistance);
      sz = Math.max(1, Math.floor(notionalUsd / ctUsdVal));
      slPrice = sig.direction === 'long' ? m.price - slDistance : m.price + slDistance;
      tpPrice = sig.direction === 'long' ? m.price + tpDistance : m.price - tpDistance;
      console.log(`  [LAB] ATR=${profile.atr.toFixed(4)} (${(profile.atrPct*100).toFixed(2)}%) sizeMult=${profile.sizeMult.toFixed(2)}`);
    } else {
      sz = Math.max(1, Math.floor(equity*riskPct*useLev*(sig.sizeM||1)*sessionSizeMult/ctUsdVal));
      slPrice = null;
      tpPrice = null;
    }
    console.log(`  → ${sig.direction.toUpperCase()} sz=${sz} lev=${useLev}x ~$${(sz*ctUsdVal).toFixed(0)} margin≈$${(sz*ctUsdVal/useLev).toFixed(0)} SL=${formatPx(slPrice)||'?'} TP=${formatPx(tpPrice)||'?'}`);

    await apiPost('/api/v5/account/set-leverage',{instId,lever:String(useLev),mgnMode:'cross',posSide:'long'});
    await apiPost('/api/v5/account/set-leverage',{instId,lever:String(useLev),mgnMode:'cross',posSide:'short'});

    // ── Fix #3: Attach exchange-side SL/TP algo at entry (lab) ─────────────
    const orderBody = {
      instId, tdMode:'cross',
      side: sig.direction==='long' ? 'buy' : 'sell',
      ordType:'market',
      sz:String(sz),
      posSide: sig.direction==='long' ? 'long' : 'short',
    };
    let slClOrdId = null;
    if (slPrice && tpPrice) {
      slClOrdId = `lab${instId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 14)}${Date.now().toString().slice(-10)}`.slice(0, 32);
      orderBody.attachAlgoOrds = [{
        attachAlgoClOrdId: slClOrdId,
        slTriggerPx: formatPx(slPrice),
        slOrdPx: '-1',
        slTriggerPxType: 'last',
        tpTriggerPx: formatPx(tpPrice),
        tpOrdPx: '-1',
        tpTriggerPxType: 'last',
      }];
    }
    const r = await apiPost('/api/v5/trade/order', orderBody);
    if (r?.code==='0') {
      const e = sig.direction==='long'?'LONG':'SHORT';
      const smcActive = [
        m.smc?.wyckoff     && `Spring(${m.smc.wyckoff.strength})`,
        m.smc?.utad        && `UTAD(${m.smc.utad.strength})`,
        m.smc?.bullTrap    && `BullTrap(${m.smc.bullTrap.strength})`,
        m.smc?.bearTrap    && `BearTrap(${m.smc.bearTrap.strength})`,
        m.smc?.stopHunt    && `StopHunt:${m.smc.stopHunt.type.includes('bull')?'bull':'bear'}`,
        m.smc?.absorption  && `Absorb:${m.smc.absorption.context}`,
        m.lsrLongPct       && `LSR:${(m.lsrLongPct*100).toFixed(0)}%L`,
      ].filter(Boolean).join(' ');
      // Journal: record new entry
      journalWrite({ type:'open', instId, dir: sig.direction.toUpperCase(),
        price: m.price, sz, lev: useLev, score: sig.score, confidence: sig.confidence,
        fg: fg.value, trend4h: m.trend4h, smc: smcActive||'none',
        slPrice, tpPrice, session });
      try {
        appendFileSync(JOURNAL_FILE_NANOCLAW, JSON.stringify({
          type: 'open', bot: 'lab', instId, dir: sig.direction.toUpperCase(),
          price: m.price, sz, lev: useLev, score: sig.score,
          confidence: sig.confidence, fg: fg.value, ts: ts,
          slPrice, tpPrice, session
        }) + '\n');
      } catch {}
      await tg(`*[LAB] OPEN ${e}* ${instId}\nLev:${useLev}x | ${sz}ct | Entry:$${m.price.toFixed(2)}\nSL:$${formatPx(slPrice)||'-'} TP:$${formatPx(tpPrice)||'-'}\nConf:${sig.confidence} | Score:${sig.score.toFixed(2)} | Sess:${session}\nFG:${fg.value}(${fg.label})\nSMC: ${smcActive||'none'}\n${sig.reasons.slice(0,5).join(', ')}\nEquity:$${equity.toFixed(2)}`);
      if (!state.openData) state.openData = {};
      state.openData[instId] = {
        ts_open: ts, entry: m.price, leverage: useLev, confidence: sig.confidence,
        btc_bias: btcTrend?.bias || null, fear_greed: fg.value, funding_rate: m?.fr || null,
        claude_reasoning: state.openData?.[instId]?.claude_reasoning || null,
        score_breakdown: sig.scoreBreakdown || null,
        atrSlPrice: slPrice,
        atrTpPrice: tpPrice,
        slAlgoClOrdId: slClOrdId,
        atrAtEntry: profile?.atr || null,
        atrPctAtEntry: profile?.atrPct || null,
        session,
      };
      openNow.push({instId});
    } else {
      console.log(`  Failed: ${r?.data?.[0]?.sMsg||JSON.stringify(r).slice(0,80)}`);
    }
    await new Promise(r=>setTimeout(r,1000));
  }
}

// Self-evolution check (runs every 6h)
await selfEvolve(params, state);
await sanityCheck(params, state);

state.log.push({ts, equity, fg: fg.value, openPos: openNow.length});
if (state.log.length > 500) state.log = state.log.slice(-500);
saveState(state);
console.log(`\n${'═'.repeat(65)}`);
