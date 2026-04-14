// ══════════════════════════════════════════════════════════════════════════
// OKX Bot Monitor — Preact dashboard
// ══════════════════════════════════════════════════════════════════════════
// Uses Preact + HTM via ESM CDN (no build step). Preact gives React-like
// hooks/components; HTM gives tagged-template JSX alternative. If you want
// to migrate to real React later, swap the three imports below.
// ══════════════════════════════════════════════════════════════════════════

import { h, render } from 'https://esm.sh/preact@10.19.6';
import { useState, useEffect, useMemo, useCallback } from 'https://esm.sh/preact@10.19.6/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

// ── Formatting helpers ──────────────────────────────────────────────────────
const fmtMoney = (n, digits) => {
  if (n == null || !isFinite(n)) return '–';
  const a = Math.abs(n);
  if (digits != null) return '$' + n.toFixed(digits);
  if (a >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 10)   return '$' + n.toFixed(2);
  if (a >= 1)    return '$' + n.toFixed(3);
  if (a >= 0.01) return '$' + n.toFixed(4);
  return '$' + Number(n).toPrecision(4);
};
const fmtPct = (n, digits = 2) => {
  if (n == null || !isFinite(n)) return '–';
  return (n >= 0 ? '+' : '') + (n * 100).toFixed(digits) + '%';
};
const fmtNum = (n, digits = 2) => {
  if (n == null || !isFinite(n)) return '–';
  return Number(n).toFixed(digits);
};
const fmtDuration = (ms) => {
  if (!ms || ms < 0) return '–';
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
};
const fmtTs = (iso) => {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
};
const fmtAgo = (iso) => {
  if (!iso) return '–';
  return fmtDuration(Date.now() - new Date(iso).getTime()) + ' ago';
};
const sym = (instId) => (instId || '').split('-')[0];

// ── Tiny SVG sparkline ──────────────────────────────────────────────────────
function Sparkline({ values, color = '#58a6ff' }) {
  if (!values || values.length < 2) return html`<div class="sparkline"></div>`;
  const w = 300, hgt = 42, pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = hgt - pad - ((v - min) / range) * (hgt - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return html`
    <svg class="sparkline" viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke="${color}"
        stroke-width="1.5"
        points="${points}" />
    </svg>
  `;
}

// ── Score bar ───────────────────────────────────────────────────────────────
function ScoreBar({ score }) {
  if (score == null) return html`<span class="mute">–</span>`;
  const pct = Math.max(-1, Math.min(1, score));
  const width = Math.abs(pct) * 50; // 50% of bar = full
  const left = pct >= 0 ? 50 : 50 - width;
  return html`
    <span class="score-bar">
      <span class="mid"></span>
      <span
        class="fill ${pct < 0 ? 'neg' : ''}"
        style="left:${left}%;width:${width}%"></span>
    </span>
    <span class="mono">${score.toFixed(2)}</span>
  `;
}

// ── Distance-to-SL bar ──────────────────────────────────────────────────────
function DistBar({ dist }) {
  if (dist == null) return html`<span class="mute">–</span>`;
  // Clamp 0..0.05 to 0..100% (anything ≥ 5% away fills the whole bar)
  const pct = Math.max(0, Math.min(1, dist / 0.05));
  const cls = dist < 0.005 ? 'crit' : dist < 0.012 ? 'warn' : '';
  return html`
    <span class="dist-bar ${cls}">
      <span style="width:${(pct * 100).toFixed(0)}%"></span>
    </span>
    <span class="mono">${(dist * 100).toFixed(2)}%</span>
  `;
}

// ── Top bar ─────────────────────────────────────────────────────────────────
function TopBar({ connectionStatus, bot, onBotChange, stats }) {
  return html`
    <div class="topbar">
      <div class="brand ${connectionStatus}">
        <span class="dot"></span>OKX Monitor
      </div>
      <div class="bot-switch">
        <button class=${bot === 'main' ? 'active' : ''} onClick=${() => onBotChange('main')}>main</button>
        <button class=${bot === 'lab'  ? 'active' : ''} onClick=${() => onBotChange('lab')}>lab</button>
      </div>
      <div class="meta">
        ${stats?.eventCount ? `${stats.eventCount} evts` : ''}${' '}
        ${stats?.sseClients != null ? `· ${stats.sseClients} clients` : ''}${' '}
        ${stats?.latestTs ? `· ${fmtTs(stats.latestTs)}` : ''}
      </div>
    </div>
  `;
}

// ── Headline KPI grid ───────────────────────────────────────────────────────
function Headline({ snapshot, prevEquity, equityHistory }) {
  if (!snapshot) return html`<div class="headline"><div class="kpi"><div class="label">no data</div></div></div>`;
  const acct = snapshot.account;
  const ctx = snapshot.context;
  const dEq = prevEquity != null ? acct.equity - prevEquity : null;
  const ddCls = acct.dd >= 0.10 ? 'warn' : acct.dd >= 0.15 ? 'neg' : '';
  const fgBadge = ctx.fg <= 10 ? '☢☢' : ctx.fg <= 25 ? '☢' : ctx.fg >= 90 ? '🔥🔥' : ctx.fg >= 75 ? '🔥' : '';
  const btcArrow = ctx.btc_bias > 0.05 ? '↑' : ctx.btc_bias < -0.05 ? '↓' : '→';
  return html`
    <div class="headline">
      <div class="kpi">
        <div class="label">Equity</div>
        <div class="value">${fmtMoney(acct.equity)}</div>
        <div class="sub ${dEq >= 0 ? 'pos' : 'neg'}">
          ${dEq != null ? (dEq >= 0 ? '▲' : '▼') + fmtMoney(Math.abs(dEq), 2) : '–'}
        </div>
      </div>
      <div class="kpi ${ddCls}">
        <div class="label">Drawdown</div>
        <div class="value">${(acct.dd * 100).toFixed(1)}%</div>
        <div class="sub">peak ${fmtMoney(acct.peak_equity)}</div>
      </div>
      <div class="kpi">
        <div class="label">Fear &amp; Greed</div>
        <div class="value">${ctx.fg} ${fgBadge}</div>
        <div class="sub">${ctx.fg_label} / ${ctx.fg_trend}</div>
      </div>
      <div class="kpi">
        <div class="label">BTC</div>
        <div class="value">${btcArrow} ${fmtMoney(ctx.btc_price)}</div>
        <div class="sub">${ctx.btc_label || ''}</div>
      </div>
      <div class="kpi">
        <div class="label">Session</div>
        <div class="value">${(ctx.session || '').toUpperCase()}</div>
        <div class="sub">${new Date(snapshot.ts).toISOString().slice(11, 16)} UTC</div>
      </div>
      <div class="kpi">
        <div class="label">Positions</div>
        <div class="value">${acct.open_positions}</div>
        <div class="sub">consec SL: ${acct.consecutive_sl || 0}</div>
      </div>
      <div class="kpi">
        <div class="label">Params v${snapshot.params_version}</div>
        <div class="value" style="font-size:14px">${snapshot.bot}</div>
        <div class="sub">${ctx.cycle_phase || ''}</div>
      </div>
      <div class="kpi" style="grid-column: span 2">
        <div class="label">Equity (last ${equityHistory.length})</div>
        <${Sparkline} values=${equityHistory} color="#3fb950" />
      </div>
    </div>
  `;
}

// ── Positions table ─────────────────────────────────────────────────────────
function PositionsTable({ positions }) {
  if (!positions || positions.length === 0) {
    return html`
      <section>
        <h2>Open Positions <span class="count">(0)</span></h2>
        <div class="alerts"><div class="empty">No open positions.</div></div>
      </section>
    `;
  }
  return html`
    <section>
      <h2>
        Open Positions <span class="count">(${positions.length})</span>
        <div class="spacer"></div>
        <span class="small">🔒 = exchange SL live</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Dir</th>
            <th>Lev</th>
            <th>Age</th>
            <th>Entry → Cur</th>
            <th>PnL%</th>
            <th>HWM%</th>
            <th>SL @</th>
            <th>Dist to SL</th>
            <th>Exch</th>
            <th>Entry / Cur Score</th>
            <th>ATR%</th>
            <th>FR</th>
            <th>Risk $</th>
          </tr>
        </thead>
        <tbody>
          ${positions.map(p => {
            const pnlCls = (p.pnl_pct || 0) >= 0 ? 'pos' : 'neg';
            const scoreFade = p.entry_score != null && p.current_score != null
              ? (p.dir === 'LONG' && p.current_score < p.entry_score * 0.5) ||
                (p.dir === 'SHORT' && p.current_score > p.entry_score * 0.5)
              : false;
            return html`
              <tr>
                <td><b>${sym(p.instId)}</b></td>
                <td><span class="badge ${p.dir === 'LONG' ? 'long' : 'short'}">${p.dir}</span></td>
                <td>${p.lever}x</td>
                <td class="dim">${fmtDuration(p.age_ms)}</td>
                <td>${fmtMoney(p.entry)} → ${fmtMoney(p.current)}</td>
                <td class="${pnlCls}">${fmtPct(p.pnl_pct)}</td>
                <td class="dim">${fmtPct(p.hwm, 1)}</td>
                <td>${fmtMoney(p.sl_price)}</td>
                <td><${DistBar} dist=${p.dist_to_sl_pct} /></td>
                <td>${p.exchange_sl_ok ? '🔒' : html`<span class="warn">⚠ local</span>`}</td>
                <td class=${scoreFade ? 'warn' : ''}>
                  ${fmtNum(p.entry_score)} → ${fmtNum(p.current_score)}
                  ${scoreFade ? ' ⚠' : ''}
                </td>
                <td class="dim">${p.atr_pct_now != null ? (p.atr_pct_now * 100).toFixed(2) + '%' : '–'}</td>
                <td class="dim">${p.funding_rate != null ? p.funding_rate.toFixed(3) + '%' : '–'}</td>
                <td class="dim">${fmtMoney(p.risk_usd_at_entry, 2)}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </section>
  `;
}

// ── Scan table with expandable indicator detail ─────────────────────────────
function ScanRow({ row, expanded, onToggle }) {
  const dirBadge = row.direction === 'long' ? 'long'
                  : row.direction === 'short' ? 'short' : 'wait';
  const dirLabel = row.direction ? row.direction.toUpperCase() : 'WAIT';
  const confBadge = row.confidence === 'high' ? 'hi'
                   : row.confidence === 'medium' ? 'med' : 'low';
  return html`
    <tr class=${expanded ? 'expanded' : ''}>
      <td>
        <span class="expand-arrow ${expanded ? 'open' : ''}" onClick=${onToggle}>▶</span>
        ${' '}<b>${sym(row.instId)}</b>
      </td>
      <td>${fmtMoney(row.price)}</td>
      <td><${ScoreBar} score=${row.score} /></td>
      <td><span class="badge ${dirBadge}">${dirLabel}</span></td>
      <td><span class="badge ${confBadge}">${row.confidence || '–'}</span></td>
      <td class="dim">${row.trend_4h || '–'}</td>
      <td>${fmtNum(row.rsi_1h, 0)} / ${fmtNum(row.rsi_4h, 0)} / ${fmtNum(row.rsi_d, 0)}</td>
      <td class="dim">${row.fr != null ? row.fr.toFixed(3) + '%' : '–'}</td>
      <td class="dim">${row.profile?.atr_pct != null ? (row.profile.atr_pct * 100).toFixed(2) + '%' : '–'}</td>
      <td class="dim">${row.profile?.max_lev || '–'}x</td>
      <td class="dim" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">
        ${(row.top_reasons || []).slice(0, 3).join(' · ')}
      </td>
    </tr>
    ${expanded ? html`
      <tr class="detail show">
        <td colspan="11"><${IndicatorGrid} row=${row} /></td>
      </tr>
    ` : null}
  `;
}

function Cell({ k, v, cls }) {
  return html`<div class="cell"><span class="k">${k}</span><span class="v ${cls || ''}">${v == null ? '–' : v}</span></div>`;
}

function IndicatorGrid({ row }) {
  const smc = row.smc || {};
  return html`
    <div class="ind-grid">
      <div class="group-header">TREND / MOMENTUM</div>
      <${Cell} k="Price"     v=${fmtMoney(row.price)} />
      <${Cell} k="Trend 4H"  v=${row.trend_4h || '–'} />
      <${Cell} k="Bull trend" v=${row.bull_trend ? 'YES' : 'no'} cls=${row.bull_trend ? 'pos' : 'mute'} />
      <${Cell} k="Bear trend" v=${row.bear_trend ? 'YES' : 'no'} cls=${row.bear_trend ? 'neg' : 'mute'} />
      <${Cell} k="Daily bull" v=${row.daily_bull ? 'YES' : 'no'} cls=${row.daily_bull ? 'pos' : 'mute'} />
      <${Cell} k="Near high"  v=${row.near_high ? 'YES' : 'no'} />
      <${Cell} k="Near low"   v=${row.near_low ? 'YES' : 'no'} />

      <div class="group-header">RSI (14)</div>
      <${Cell} k="RSI 1H"  v=${fmtNum(row.rsi_1h, 1)} cls=${row.rsi_1h < 30 ? 'pos' : row.rsi_1h > 70 ? 'neg' : ''} />
      <${Cell} k="RSI 4H"  v=${fmtNum(row.rsi_4h, 1)} cls=${row.rsi_4h < 35 ? 'pos' : row.rsi_4h > 65 ? 'neg' : ''} />
      <${Cell} k="RSI D"   v=${fmtNum(row.rsi_d, 1)}  cls=${row.rsi_d < 38 ? 'pos' : row.rsi_d > 70 ? 'neg' : ''} />
      <${Cell} k="RSI Div 1H" v=${row.rsi_div_1h || '–'} cls=${row.rsi_div_1h === 'bullish' ? 'pos' : row.rsi_div_1h === 'bearish' ? 'neg' : 'mute'} />
      <${Cell} k="RSI Div 4H" v=${row.rsi_div_4h || '–'} cls=${row.rsi_div_4h === 'bullish' ? 'pos' : row.rsi_div_4h === 'bearish' ? 'neg' : 'mute'} />

      <div class="group-header">MACD / BB / VOL</div>
      <${Cell} k="MACD hist" v=${fmtNum(row.macd_hist, 3)} cls=${row.macd_hist > 0 ? 'pos' : 'neg'} />
      <${Cell} k="BB %B" v=${fmtNum(row.bb_pct, 2)} cls=${row.bb_pct < 0.05 ? 'pos' : row.bb_pct > 0.95 ? 'neg' : ''} />
      <${Cell} k="Vol ratio (3/20)" v=${fmtNum(row.vol_ratio, 2)} cls=${row.vol_ratio > 1.8 ? 'pos' : row.vol_ratio < 0.5 ? 'mute' : ''} />

      <div class="group-header">MICROSTRUCTURE</div>
      <${Cell} k="Funding" v=${row.fr != null ? row.fr.toFixed(4) + '%' : '–'} cls=${Math.abs(row.fr || 0) > 0.08 ? 'warn' : ''} />
      <${Cell} k="Fund long crowded" v=${row.fund_long ? 'YES' : 'no'} cls=${row.fund_long ? 'warn' : 'mute'} />
      <${Cell} k="Fund short crowded" v=${row.fund_short ? 'YES' : 'no'} cls=${row.fund_short ? 'warn' : 'mute'} />
      <${Cell} k="OI current" v=${row.oi_current != null ? row.oi_current.toLocaleString('en-US', {maximumFractionDigits:0}) : '–'} />
      <${Cell} k="LSR long%" v=${row.lsr_long_pct != null ? (row.lsr_long_pct * 100).toFixed(0) + '%' : '–'} />
      <${Cell} k="Price 24h" v=${fmtPct(row.price_chg_24h, 1)} cls=${(row.price_chg_24h || 0) >= 0 ? 'pos' : 'neg'} />
      <${Cell} k="Liquidity sweep" v=${row.liq_sweep || 'none'} cls=${row.liq_sweep ? 'warn' : 'mute'} />
      <${Cell} k="FVG" v=${row.fvg || 'none'} cls=${row.fvg ? 'warn' : 'mute'} />

      <div class="group-header">SMC SIGNALS</div>
      <${Cell} k="Wyckoff Spring" v=${smc.wyckoff || '–'} cls=${smc.wyckoff ? 'pos' : 'mute'} />
      <${Cell} k="UTAD"           v=${smc.utad || '–'}    cls=${smc.utad ? 'neg' : 'mute'} />
      <${Cell} k="Bull trap"      v=${smc.bull_trap || '–'} cls=${smc.bull_trap ? 'neg' : 'mute'} />
      <${Cell} k="Bear trap"      v=${smc.bear_trap || '–'} cls=${smc.bear_trap ? 'pos' : 'mute'} />
      <${Cell} k="Stop hunt"      v=${smc.stop_hunt || '–'} />
      <${Cell} k="Absorption"     v=${smc.absorption || '–'} />
      <${Cell} k="Funding trap"   v=${smc.funding_trap || '–'} cls=${smc.funding_trap ? 'warn' : 'mute'} />
      <${Cell} k="LSR signal"     v=${smc.lsr || '–'} />
      <${Cell} k="OI divergence"  v=${smc.oi_div || '–'} />

      <div class="group-header">INSTRUMENT PROFILE</div>
      <${Cell} k="ATR (1H)"       v=${fmtNum(row.profile?.atr, 4)} />
      <${Cell} k="ATR %"          v=${row.profile?.atr_pct != null ? (row.profile.atr_pct * 100).toFixed(2) + '%' : '–'} />
      <${Cell} k="24h vol USD"    v=${row.profile?.vol_usd != null ? '$' + (row.profile.vol_usd / 1e6).toFixed(0) + 'M' : '–'} />
      <${Cell} k="Liquidity score" v=${row.profile?.liquidity_score != null ? row.profile.liquidity_score.toFixed(2) : '–'} />
      <${Cell} k="Size multiplier" v=${row.profile?.size_mult != null ? row.profile.size_mult.toFixed(2) : '–'} />
      <${Cell} k="Max leverage"   v=${row.profile?.max_lev ? row.profile.max_lev + 'x' : '–'} />

      <div class="group-header">DECISION</div>
      <${Cell} k="Final score"    v=${fmtNum(row.score, 2)} />
      <${Cell} k="Direction"      v=${row.direction || 'wait'} />
      <${Cell} k="Confidence"     v=${row.confidence || '–'} />
      <${Cell} k="Suggest lev"    v=${row.suggested_leverage != null ? row.suggested_leverage + 'x' : '–'} />
      <${Cell} k="Suggest size×"  v=${row.suggested_size_mult != null ? row.suggested_size_mult.toFixed(2) : '–'} />
    </div>
  `;
}

function ScanSection({ scan, expandedInst, onToggle }) {
  if (!scan || scan.length === 0) {
    return html`
      <section>
        <h2>Scan <span class="count">(0)</span></h2>
        <div class="alerts"><div class="empty">No scan results.</div></div>
      </section>
    `;
  }
  const sorted = [...scan].sort((a, b) => Math.abs(b.score || 0) - Math.abs(a.score || 0));
  return html`
    <section>
      <h2>Scan <span class="count">(${sorted.length})</span>
        <div class="spacer"></div>
        <span class="small">click ▶ to expand per-instrument indicator grid</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Price</th>
            <th>Score</th>
            <th>Dir</th>
            <th>Conf</th>
            <th>4H</th>
            <th>RSI 1H/4H/D</th>
            <th>Funding</th>
            <th>ATR%</th>
            <th>MaxLev</th>
            <th>Top reasons</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(row => html`
            <${ScanRow}
              key=${row.instId}
              row=${row}
              expanded=${expandedInst === row.instId}
              onToggle=${() => onToggle(row.instId)} />
          `)}
        </tbody>
      </table>
    </section>
  `;
}

// ── Alerts section ──────────────────────────────────────────────────────────
function AlertsSection({ alerts }) {
  return html`
    <section>
      <h2>Alerts <span class="count">(${alerts?.length || 0})</span></h2>
      <ul class="alerts">
        ${alerts && alerts.length
          ? alerts.map((a, i) => html`
              <li class="${a.level}">
                <span class="level">${a.level}</span>
                <span dangerouslySetInnerHTML=${{ __html: a.text }}></span>
              </li>
            `)
          : html`<div class="empty">No active alerts this cycle.</div>`
        }
      </ul>
    </section>
  `;
}

// ── Recent closes ───────────────────────────────────────────────────────────
function ClosesSection({ closes }) {
  if (!closes || closes.length === 0) {
    return html`
      <section>
        <h2>Recent closes <span class="count">(0)</span></h2>
        <div class="alerts"><div class="empty">No closes yet.</div></div>
      </section>
    `;
  }
  return html`
    <section>
      <h2>Recent closes <span class="count">(${closes.length})</span></h2>
      <table>
        <thead>
          <tr>
            <th>Closed</th>
            <th>Sym</th>
            <th>Dir</th>
            <th>Entry → Exit</th>
            <th>PnL%</th>
            <th>Reason</th>
            <th>Held</th>
            <th>Session</th>
            <th>Score (entry → exit)</th>
          </tr>
        </thead>
        <tbody>
          ${[...closes].reverse().map(c => {
            const heldMs = c.ts_open && c.ts_close
              ? new Date(c.ts_close).getTime() - new Date(c.ts_open).getTime()
              : null;
            const cls = (c.pnl_pct || 0) >= 0 ? 'pos' : 'neg';
            return html`
              <tr>
                <td class="dim">${fmtTs(c.ts_close)}</td>
                <td><b>${sym(c.instrument)}</b></td>
                <td><span class="badge ${c.direction === 'LONG' ? 'long' : 'short'}">${c.direction}</span></td>
                <td>${fmtMoney(c.entry)} → ${fmtMoney(c.exit)}</td>
                <td class="${cls}">${fmtPct(c.pnl_pct)}</td>
                <td>
                  <span class="exit-reason ${c.exit_reason_type || ''}">
                    ${c.exit_reason_type || c.exit_reason || '?'}
                  </span>
                </td>
                <td class="dim">${fmtDuration(heldMs)}</td>
                <td class="dim">${c.session || '–'}</td>
                <td class="dim">${fmtNum(c.entry_score)} → ${fmtNum(c.score)}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </section>
  `;
}

// ── Main App ────────────────────────────────────────────────────────────────
function App() {
  const [bot, setBot] = useState('main');
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotHistory, setSnapshotHistory] = useState([]);
  const [closes, setCloses] = useState([]);
  const [stats, setStats] = useState(null);
  const [expandedInst, setExpandedInst] = useState(null);
  const [connStatus, setConnStatus] = useState('connecting');

  // Initial load
  const reload = useCallback(async () => {
    try {
      const [latestR, histR, closesR, statsR] = await Promise.all([
        fetch(`/api/latest?bot=${bot}`).then(r => r.json()),
        fetch(`/api/snapshots?bot=${bot}&limit=60`).then(r => r.json()),
        fetch(`/api/closes?limit=30`).then(r => r.json()),
        fetch(`/api/stats`).then(r => r.json()),
      ]);
      setSnapshot(latestR);
      setSnapshotHistory(histR || []);
      setCloses((closesR || []).filter(c => c.bot === bot));
      setStats(statsR);
    } catch (e) {
      console.error('reload failed', e);
    }
  }, [bot]);

  useEffect(() => { reload(); }, [reload]);

  // SSE live updates
  useEffect(() => {
    setConnStatus('connecting');
    const es = new EventSource('/events');
    es.onopen = () => setConnStatus('connected');
    es.onerror = () => setConnStatus('disconnected');
    es.onmessage = (e) => {
      if (!e.data) return;
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.type === 'cycle_snapshot' && ev.bot === bot) {
        setSnapshot(ev);
        setSnapshotHistory(h => [...h.slice(-59), ev]);
      }
      if (ev.type === 'close' && ev.bot === bot) {
        setCloses(c => [...c.slice(-29), ev]);
      }
    };
    return () => es.close();
  }, [bot]);

  // Stats refresher
  useEffect(() => {
    const t = setInterval(() => {
      fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {});
    }, 15000);
    return () => clearInterval(t);
  }, []);

  const equityHistory = useMemo(
    () => snapshotHistory.map(s => s?.account?.equity).filter(v => typeof v === 'number'),
    [snapshotHistory]
  );
  const prevEquity = snapshotHistory.length >= 2
    ? snapshotHistory[snapshotHistory.length - 2]?.account?.equity
    : null;

  const toggleExpand = (instId) => {
    setExpandedInst(cur => cur === instId ? null : instId);
  };

  return html`
    <div class="app">
      <${TopBar}
        connectionStatus=${connStatus}
        bot=${bot}
        onBotChange=${setBot}
        stats=${stats} />
      <main>
        <${Headline}
          snapshot=${snapshot}
          prevEquity=${prevEquity}
          equityHistory=${equityHistory} />
        <${PositionsTable} positions=${snapshot?.positions || []} />
        <${AlertsSection} alerts=${snapshot?.alerts || []} />
        <${ScanSection}
          scan=${snapshot?.scan || []}
          expandedInst=${expandedInst}
          onToggle=${toggleExpand} />
        <${ClosesSection} closes=${closes} />
      </main>
    </div>
  `;
}

// ── Boot ────────────────────────────────────────────────────────────────────
render(html`<${App} />`, document.getElementById('app'));
