=== OKX Trading Bot Setup ===

Requirements: Node.js 18+

Run main bot:
  OKX_STATE_DIR=./okx-state node okx-trader.js

Run lab bot:
  OKX_STATE_DIR=./okx-state node okx-trader-lab.js

Dry run (no real trades):
  OKX_STATE_DIR=./okx-state node okx-trader.js --dry-run

Cron schedule (crontab -e):
  */30 * * * * cd /path/to/okx && OKX_STATE_DIR=./okx-state node okx-trader.js >> trader.log 2>&1
  15,45 * * * * cd /path/to/okx && OKX_STATE_DIR=./okx-state node okx-trader-lab.js >> lab.log 2>&1

Watchlist: ETH SOL XRP DOGE SUI
