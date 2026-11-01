# JEV Call Center

A mock multi-company call-center simulator for exploring the JEV LLM as a
call-center analytics tool.

## Stack

- **Vite + Vue 3** (JavaScript, no TypeScript) frontend, with
  [Observable Plot](https://observablehq.com/plot) and
  [three.js](https://threejs.org) for visualization
- **Express + better-sqlite3** backend (`server/`)
- **SQLite** persistence

## Data philosophy

The database holds **raw, append-only event streams** — no pre-aggregated or
UI-specific tables. Every simulated call and every agent status change is
written as a flat record. All charts, dashboards, leaderboards, and any future
tool (like JEV) compute their view *on demand* from those raw rows. This keeps
the data reusable for whatever experiments come later.

## Getting started

```bash
npm install
npm run seed          # sample companies/centers/queues/agents + a week of raw history
npm run dev:all       # Vite (dev) + API server together
```

Open http://localhost:5173. The API serves under http://localhost:3101 and is
proxied at `/api` during development.

### Individual processes

```bash
npm run dev       # Vite dev server
npm run server    # Express API server
```

## Data model

- **company** — a business with an IANA timezone
- **call_center** — belongs to a company; timezone, operating hours
  (`open_time`/`close_time` in minutes since local midnight), days of week, and
  a base call volume (`base_calls_per_hour`)
- **queue** — a phone number / routing target within a call center (usually one)
- **agent** — belongs to a company; associated with call centers via
  **agent_call_center** (many-to-many, all within the same company)
- **agent_status** — raw append-only status events (`from_ts`/`to_ts`): states
  `logged_out`, `available`, `on_call`, `wrap_up`, `on_break`, `meal_break`,
  `training`
- **call** — a raw interaction against a queue: UTC `started_at` plus the
  caller's `local_started_at` and `utc_offset_min`, `outcome`
  (answered/abandoned/voicemail), wait/talk seconds, topic, **mood** (caller
  state: calm/neutral/frustrated/angry), **persona** (agent style:
  empathetic/efficient/cheerful/formal), **product**, and satisfaction
- **call_turn** — raw append-only conversation turns (`caller`/`agent`/`ivr`),
  ordered by `seq`, with `offset_seconds` from the call start

## Conversations (transcripts)

`server/conversation.js` generates a unique, coherent support-call transcript
for every call using [Tracery](https://github.com/galaxykate/tracery)
(grammar-based phrasing) and [Faker](https://fakerjs.dev) (realistic names,
order/account numbers, amounts, products). Both are seeded from the call id, so
a transcript is deterministic per call.

The generator is driven by an extensible **scenario** — `{ topic, mood, persona,
product }` — where each dimension selects a different family of grammar rules.
To add a new mood/persona/product, append to the `MOODS`/`PERSONAS`/`PRODUCTS`
catalogs and add the matching `caller_greeting_<mood>`, `opening_<persona>`,
etc. rules in the grammar (see the notes at the top of that file). No other code
needs to change.

These dimensions are persisted as raw columns on each `call`, so they can later
be configured through a UI to shape simulation output without schema changes.

The Dashboard has a **Scenario Configuration** panel (topic / mood / persona /
product dropdowns). The underlying API exposes the catalogs and accepts a
scenario override:

- `GET /api/scenario/options` — `topics`, `moods`, `personas`, `products`
- `POST /api/simulate` accepts an optional `scenario` object
  (`{ topic, mood, persona, product }`); provided fields are fixed for every
  call in the run, omitted fields are randomized
- `POST /api/simulate/live/start` accepts the same `scenario` object

## Simulation

The simulator (`server/generator.js`) steps minute-by-minute, decides whether
each call center is open (local time + days of week), applies a time-of-day
volume curve with noise, and routes calls to available agents. It writes raw
`call` and `agent_status` records as it goes. Two modes share this core:

- **Historical** — `POST /api/simulate` backfills a past window (also available
  from the Dashboard "Simulate last 24h / 7 days" buttons).
- **Live** — `POST /api/simulate/live/start` begins a server-driven tick loop
  that generates data in near-real time; the Dashboard has Start/Stop controls.
  Mouse/keyboard activity sends a heartbeat, and an **idle kill switch**
  (`LIVE_IDLE_TIMEOUT_MS`, default 1 hour) stops it when the page has no user
  activity.

```bash
curl -X POST http://localhost:3101/api/simulate \
  -H 'Content-Type: application/json' \
  -d '{"from":"2026-10-01T00:00:00Z","to":"2026-10-08T00:00:00Z"}'
```

## Configure JEV

Copy `.env.example` to `.env` and set `TYPESAFE_API_KEY` (your key from
https://console.typesafe.ai/keys). Optionally override `TYPESAFE_BASE_URL`
(default `https://api.typesafe.ai/v1`) and `TYPESAFE_MODEL` (default
`jev-latest`).

JEV is a System One model (not a chat model): it evaluates typed *questions*
against a *state* and returns structured answers. See `server/jev.js` and
https://docs.typesafe.ai/api.

## API

- `GET /api/companies`, `POST /api/companies`
- `GET/POST /api/call-centers`
- `GET /api/queues`
- `GET /api/agents`, `GET /api/agents/:id/centers`
- `GET /api/agent-statuses`
- `GET /api/calls`
- `GET /api/calls/:id/transcript` — ordered conversation turns for a call
- `POST /api/simulate` — accepts optional `scenario` override
- `POST /api/simulate/live/start|stop|heartbeat`, `GET /api/simulate/live/state`
- `GET /api/scenario/options` — topics/moods/personas/products catalogs
- `GET /api/analytics/leaderboard` — per-center metrics computed from raw calls
- `GET /api/analytics/timeseries?bucket=hour|minute[&centerId=n]`
- `GET /api/analytics/topics`, `GET /api/analytics/outcomes`
- `GET /api/analytics/agent-occupancy` — current agent status counts
- `GET /api/jev/status`, `POST /api/jev/evaluate`