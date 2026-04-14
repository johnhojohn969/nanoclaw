=== OKX Trading Bot Setup ===

Requirements: Node.js 18+

Run main bot:
  OKX_STATE_DIR=./okx-state node okx-trader.js

Run lab bot:
  OKX_STATE_DIR=./okx-state node okx-trader-lab.js

Dry run (no real trades):
  OKX_STATE_DIR=./okx-state node okx-trader.js --dry-run

Cron schedule (crontab -e) — 5-minute cadence for short-term reactivity:
  */5 * * * *    cd /path/to/okx && OKX_STATE_DIR=./okx-state node okx-trader.js     >> trader.log 2>&1
  2-59/5 * * * * cd /path/to/okx && OKX_STATE_DIR=./okx-state node okx-trader-lab.js >> lab.log    2>&1

Notes on the 5-minute cadence:
  - Main scans for new entries 6x more often (5 min gap vs 30 min) so intraday
    signal setups are caught much sooner.
  - Lab offset by 2 min from main (e.g., lab at :02/:07/:12, main at :00/:05/:10)
    to reduce race on shared params.json.
  - The Telegram compact monitor report is throttled to every ~25 min, with
    bypass on: critical alerts, position count change, or self-evolve bump.
    Open/close/SL/TP notifications fire on every cycle as usual.
  - Server-side trailing stop (OKX move_order_stop) means profit-locking runs
    at tick speed between cycles — cron cadence only affects NEW signal speed,
    not exit/trailing responsiveness.

Watchlist: ETH SOL XRP DOGE SUI

Web monitor UI:
  cd ui && OKX_STATE_DIR=../okx-state node server.js
  → http://127.0.0.1:8787
  Live dashboard reading journal.jsonl with SSE live-updates.
  See ui/README.md for environment variables, API, and security notes.
