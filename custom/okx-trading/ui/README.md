# OKX Bot Monitor (UI)

Local web dashboard for the OKX trading bot. Reads `journal.jsonl` and streams
live updates over Server-Sent Events. Zero dependencies — pure Node.js +
Preact/HTM via ESM CDN (no build step).

## Run

```bash
# From custom/okx-trading/ui
OKX_STATE_DIR=../okx-state node server.js

# Or if journal lives in the default nanoclaw state dir
OKX_STATE_DIR=/home/john/.nanoclaw node server.js
```

Open <http://127.0.0.1:8787> in a browser.

## Environment

| Variable            | Default                                    | Purpose                                        |
|---------------------|--------------------------------------------|------------------------------------------------|
| `OKX_STATE_DIR`     | `../okx-state` (resolved from server.js)   | Directory containing `journal.jsonl`           |
| `PORT`              | `8787`                                     | HTTP port                                      |
| `HOST`              | `127.0.0.1`                                | Bind address (use `0.0.0.0` for LAN access)    |
| `MAX_EVENTS`        | `5000`                                     | Ring buffer size for in-memory event cache     |
| `POLL_INTERVAL_MS`  | `1000`                                     | How often to tail `journal.jsonl` (ms)         |

## How it works

1. **Backend** (`server.js`) reads `journal.jsonl` on startup into a ring
   buffer, then polls file size every `POLL_INTERVAL_MS`. New bytes are
   parsed as JSONL and pushed to connected SSE clients.
2. **SSE stream** at `/events` pushes every new journal line to the browser.
3. **Frontend** (`public/app.js`) is a Preact app using hooks (`useState`,
   `useEffect`) and HTM (tagged-template JSX alternative). Both loaded from
   `esm.sh` — no build step required.
4. Dashboard subscribes to `/events`, updates in place when a new
   `cycle_snapshot` event arrives for the currently-selected bot.

## API endpoints

| Endpoint                        | Returns                                          |
|---------------------------------|--------------------------------------------------|
| `GET /api/latest?bot=main`      | Latest `cycle_snapshot` for the given bot        |
| `GET /api/snapshots?bot=main&limit=60` | Recent snapshots, chronological         |
| `GET /api/closes?limit=30`      | Recent `close` trade events                      |
| `GET /api/opens?limit=30`       | Recent `open` trade events                       |
| `GET /api/stats`                | Event count, SSE client count, journal path      |
| `GET /events`                   | SSE stream of new journal events (live)          |

## Security notes

- **Defaults to `127.0.0.1`** — only localhost can access. If you bind to
  `0.0.0.0` (LAN), keep in mind the dashboard shows account equity, open
  positions, and signal internals. Anyone on the network can read it.
- **No authentication** — there's no login wall. Don't expose to the public
  internet without fronting with auth (nginx basic auth, Cloudflare Access,
  Tailscale, etc.).
- **Read-only** — the server never writes to `journal.jsonl` or executes
  trades. It only reads from disk.

## Upgrading to real React

Swap the three ESM imports in `public/app.js`:

```js
// before
import { h, render } from 'https://esm.sh/preact@10.19.6';
import { useState, useEffect, useMemo, useCallback } from 'https://esm.sh/preact@10.19.6/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

// after (real React + ReactDOM)
import { createElement as h } from 'https://esm.sh/react@18';
import { createRoot } from 'https://esm.sh/react-dom@18/client';
import { useState, useEffect, useMemo, useCallback } from 'https://esm.sh/react@18';
import htm from 'https://esm.sh/htm@3.1.1';

// and replace the render() call with:
// createRoot(document.getElementById('app')).render(html`<${App} />`);
```

Preact ships a 3KB runtime vs React's ~45KB — for a local dev tool the
difference is negligible, but Preact keeps the page faster to cold-load.

## Future work

- **Signal contribution breakdown** — phase 2 of bot telemetry (refactor
  `generateSignal` to emit `breakdown: [{name, input, weight, delta}]`).
  Once the bot writes it, the indicator-detail grid can show per-indicator
  score contribution, not just raw values.
- **Historical charts** — time-series of score, pnl, ATR per instrument.
  Currently only the equity sparkline in the headline.
- **Trade replay** — scrub through historical snapshots to see what the
  bot saw at any past cycle.
