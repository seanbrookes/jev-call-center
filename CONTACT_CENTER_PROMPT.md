Build a web application called "jev-call-center" — a mock, multi-company call-center
simulator whose purpose is to generate realistic call + transcript data and then
evaluate that data with JEV (TypeSafe's "System One" model) as a call-center
analytics tool. Treat this as a greenfield project.

====================================================================
PREAMBLE / PREREQUISITES / BUILD ORDER
====================================================================
PRIORITY: The CALL ENGINE SIMULATOR comes first and MUST be fully functional and
complete BEFORE any JEV work. JEV is OPTIONAL and should be STUBBED OUT initially.
You may not have a JEV API key when you start — that is expected and fine.

Prerequisites on the target machine:
- Node.js >= 22.5 with npm (no other runtimes needed).
- SQLite (better-sqlite3 is a native dependency; it needs a C++ build toolchain).
- (Optional, LATER) A TypeSafe account + API key. NOT required to build or run the
  simulator. When a key is eventually available, set TYPESAFE_API_KEY in .env.
  The JEV API is documented at https://docs.typesafe.ai/api; the endpoint is
  POST https://api.typesafe.ai/v1/systemone with header `Authorization: Bearer <key>`.
- No other external services. All call + transcript data is generated locally with
  no network access. JEV is the ONLY network dependency, and only when enabled.

Build in this order (do NOT skip ahead):
1. Schema + seed + generator + live simulation + raw-data API. NO JEV AT ALL.
2. Transcript/conversation generator (Tracery + Faker), persisted to call_turn.
3. Analytics endpoints + basic UI (line/bar/donut charts, 3D call-volume view).
4. LAST: JEV. Isolate it behind a single module (server/jev.js) with a stable
   interface — evaluate(state, questions, model) and status(). Until a key is
   configured, evaluate() must throw a clear "JEV is not configured" error and
   every JEV feature in the UI must degrade gracefully (show "not configured" or
   "—") instead of crashing. When the key arrives, ONLY that module changes.

====================================================================
HARD REQUIREMENTS (non-negotiable)
====================================================================
1. Stack: Vite + Vue 3 (JavaScript, NOT TypeScript), Vue Router 4, Pinia 3.
   Backend: Express 5 + better-sqlite3 (SQLite, WAL mode), cors, dotenv,
   concurrently. Visualization: @observablehq/plot (0.6.x) and three (0.186+).
   Text generation: tracery-grammar (2.8.x) + @faker-js/faker (10.x).
2. Database is the single source of truth and is STRICTLY RAW + APPEND-ONLY.
   Never pre-aggregate or create UI-specific tables. All analytics/charts/JEV
   outputs are computed on-demand from raw rows.
3. The API server runs on port 3101. Vite dev server proxies /api -> localhost:3101.
4. Everything about a simulated call must be reconstructible from raw data.

====================================================================
DATA MODEL (SQLite tables, all append-only)
====================================================================
- company: id, name, timezone (IANA string), created_at
- call_center: id, company_id FK, name, timezone, open_time (minutes since local
  midnight), close_time (minutes since local midnight; 1440 = 24/7), base_calls_per_hour,
  days_of_week (comma-separated ISO weekdays, 1=Mon..7=Sun), created_at
- queue: id, call_center_id FK, number (phone/DID), name, created_at. (A call
  center usually has one queue but can have several.)
- agent: id, company_id FK, name, avg_handle_seconds, created_at
- agent_call_center: agent_id FK, call_center_id FK, composite PK. Agents are
  many-to-many with call centers, but ALL of an agent's centers must belong to
  the SAME company.
- agent_status: id, agent_id FK, call_center_id FK, status, from_ts (UTC ISO),
  to_ts (UTC ISO, NULL = still in state). Statuses: logged_out, available,
  on_call, wrap_up, on_break, meal_break, training. Raw event stream.
- call: id, company_id, call_center_id, queue_id, agent_id, started_at (UTC ISO),
  local_started_at (caller's local wall-clock, no offset), utc_offset_min,
  answered_at, ended_at, wait_seconds, talk_seconds,
  outcome ('answered'|'abandoned'|'voicemail'),
  topic, mood, persona, product, satisfaction (1..5 nullable), created_at
- call_turn: id, call_id FK, seq, speaker ('caller'|'agent'|'ivr'), text,
  offset_seconds. Raw, ordered conversation turns.

Topics: billing, account, technical-support, order-status, returns,
password-reset, cancellation, product-info, complaint, upgrade.
Caller moods: calm, neutral, frustrated, angry (weighted ~35/40/18/7).
Agent personas: empathetic, efficient, cheerful, formal.

====================================================================
SIMULATION ENGINE (server/generator.js + server/time.js)
====================================================================
- Timezone-aware. Use Node's Intl to compute a center's local time/offset/weekday.
  A center is "open" only when (a) today's weekday is in days_of_week AND
  (b) local wall-clock minutes are within [open_time, close_time).
- Step minute-by-minute over a window. For each open center, generate arrivals
  with probability base_calls_per_hour/60 modulated by a time-of-day curve (peak
  midday) and gaussian noise.
- Maintain an agent lifecycle each step (evolveAgent): agents move between the
  statuses above stochastically. Only agents currently 'available' answer calls;
  otherwise the call abandons or goes to voicemail.
- Two modes share this core:
    * historical: simulate(start, end, onProgress, scenario) backfills a past window.
    * live: tick(now, scenario) advances one simulated minute; a server setInterval
      drives it, with start/stop endpoints and an idle "kill switch".
- A "scenario" override {topic, mood, persona, product} may be passed; provided
  fields are fixed for every generated call, omitted fields are randomized.
  Topic is randomly chosen; mood/persona are weighted-random; product is assigned
  only to product-relevant topics (technical-support, returns, product-info).

====================================================================
CONVERSATION / TRANSCRIPT GENERATOR (server/conversation.js)
====================================================================
- Generate a unique, coherent support-call transcript for EVERY call (answered
  calls: full ~10-14 turn dialogue; abandoned: IVR hold prompts + "[caller hangs
  up]"; voicemail: IVR prompt + one caller message).
- Use tracery-grammar for phrasing variety and @faker-js/faker for realistic
  entities (caller name, email, phone, order #, account #, amount, product).
- BOTH are seeded from the call's numeric id, so a given call always renders the
  same transcript (deterministic/reproducible), yet every call differs.
- The generator is driven by the scenario dimensions: topic selects the
  problem/resolution grammar; mood selects the caller's greeting/venting; persona
  selects the agent's opening/ack/closing; product overrides the product entity.
  Structure it to be EXTENSIBLE: adding a mood/persona/product/topic means adding
  catalog entries + matching grammar symbol families, nothing else.

====================================================================
SEED + MIGRATIONS
====================================================================
- seed.js: 4-5 companies across timezones (US/EU/Asia + a "Global Support" UTC
  company), ~7 call centers with different hours/volumes, queues, agents (some
  associated with multiple centers of the same company), and a week of simulated
  history. Include ONE always-on center (open_time 0, close_time 1440, all 7 days)
  so live simulation always has traffic. Idempotent: skip if companies exist.
- A non-destructive migration script to add the 24/7 center to an EXISTING db.
- A backfill script to generate transcripts for existing calls lacking turns.

====================================================================
JEV INTEGRATION (server/jev.js + server/jev-questions.js)
====================================================================
JEV is TypeSafe's "System One" model — NOT a chat model. It evaluates typed
"questions" against a "state" and returns structured answers.
STUB NOTE: You may build the entire app WITHOUT a real JEV key. Implement
server/jev.js with the interface below; when TYPESAFE_API_KEY is absent,
evaluate() throws "JEV is not configured" and status() returns { configured: false }.
The frontend must not crash in that state — JEV columns show "—", the JEV views
show a "Not configured" badge, and no network calls to TypeSafe are attempted.
- Endpoint: POST https://api.typesafe.ai/v1/systemone
- Auth: Authorization: Bearer <TYPESAFE_API_KEY>
- Body: { state: string|object|array, model: "jev-latest", questions: {...} }
- Question types:
    * noul:   { type:"noul", instructions:"...?" } -> { noul: 0..1 }
    * choice: { type:"choice", instructions, criteria:{option:"desc",...} }
              -> { choice, probabilities, confidence }
    * score:  { type:"score", instructions, criteria:["low",...,"high"] }
              -> { score, legend, probabilities, confidence }
- Env: TYPESAFE_API_KEY (required), TYPESAFE_BASE_URL (default https://api.typesafe.ai/v1),
  TYPESAFE_MODEL (default jev-latest).
- Provide pre-built "packs" (question sets):
    * call-quality: sentiment(score), escalation(noul), churn_risk(noul),
      resolved(noul), intent(choice).
    * agent-quality: helpfulness(score), satisfaction(score), defect(noul).
- jev.evaluate(state, questions, model) wraps the HTTP call; jev.status() reports
  config. Batch analysis runs calls concurrently (small pool, e.g. 5-6).

====================================================================
REST API (all under /api)
====================================================================
Companies:        GET/POST /companies
Call centers:     GET/POST /call-centers?companyId=
Queues:           GET /queues?centerId=
Agents:           GET /agents?centerId=, GET /agents/:id/centers
Agent statuses:   GET /agent-statuses?centerId=&limit=
Calls:            GET /calls?centerId=&from=&to=&limit=, GET /calls/:id,
                  GET /calls/:id/transcript
Simulate:         POST /simulate {from,to,scenario?}
Live sim:         POST /simulate/live/start {scenario?}, /live/stop, /live/heartbeat,
                  GET /simulate/live/state
Scenario catalog: GET /scenario/options -> {topics, moods, personas, products}
Analytics:        GET /analytics/leaderboard, /analytics/timeseries?bucket=hour|minute&centerId=,
                  /analytics/topics, /analytics/outcomes, /analytics/agent-occupancy,
                  /analytics/volume-grid?days=7&bucket=hour|day
                  (volume-grid returns per (center, hour/day) call counts for the 3D view)
JEV:              GET /jev/status, POST /jev/evaluate {state,questions,model?},
                  GET /jev/question-sets, POST /jev/analyze {calls,packId?|questions?},
                  POST /jev/timeseries {questions,from,to,bucket,maxPerBucket?}
                  (timeseries buckets calls in a range, samples up to maxPerBucket per
                   bucket, runs JEV, returns per-bucket aggregates: noul->%yes,
                   score->avg, choice->%top)

All analytics are computed from raw call/agent_status rows via SQL on-demand.

====================================================================
FRONTEND (Vite + Vue 3, src/)
====================================================================
Routes: / (Dashboard), /call-centers, /analytics, /jev.
Layout: top nav bar + a centered content column.

Dashboard:
  - KPI stats (companies / call centers / agents counts).
  - "Scenario Configuration" panel: dropdowns for topic/mood/persona/product
    (each with a "Random" option) that feed historical + live simulation.
  - Historical simulation: "Simulate last 24h" and "last 7 days" buttons.
  - Live simulation: Start/Stop; polls live state every ~2s; sends a heartbeat
    ONLY on real user input (mousemove/keydown/etc.) so the server's idle kill
    switch stops it after ~1 hour of no activity (LIVE_IDLE_TIMEOUT_MS).

Call Centers view: tables of companies and call centers + an "add call center" form.

Analytics view (the richest):
  - 3D call-volume view (three.js InstancedMesh): one rectangular mark per call,
    tiled as a mosaic. X = time, Z = call center, flattened height. Day-striping
    (alternating light-grey/white bands along X). Large floating camera-facing
    labels per call-center lane. Raycasting: hover highlights a (time x center)
    cell with a taller light-orange box + a DOM tooltip (date/time, call count);
    clicking a cell fetches the underlying calls into a table below.
  - Column manager: a "Columns" dropdown with checkboxes to show/hide columns.
  - The selected-cell table shows, per call: ID, Outcome, plus JEV-classified
    columns (Helpfulness, Satisfaction, Defect) computed on-demand via the
    agent-quality pack, Wait/Talk (formatted mm:ss or h:mm:ss), Started, and a
    "Transcript" button that opens a right-side slide-over drawer showing the
    ordered call_turn transcript.
  - Columns are sortable (click header) and filterable (defect/satisfaction/helpfulness).
  - A "+ New question" dialog to define CUSTOM JEV questions: name, type
    (noul/score/choice), instructions, threshold, and criteria. Each saved
    question becomes a new sortable/toggleable column. Custom questions, their
    results, and column visibility are SESSION-ONLY (in-memory, cleared on refresh).
    Custom questions must be EDITABLE (pencil button in the Columns menu).
  - Other panels: call-volume-over-time line chart, answered-vs-abandoned bar,
    leaderboard, topics/outcomes/agent-occupancy donut charts.
  - "JEV Over Time" panel: pick any JEV question (built-in pack questions OR a
    custom noul) + daily/hourly bucket + Run; charts that question's aggregate
    answer across the last 7 days.

Jev view: connection status; single-call inspector (pick a recent call, see its
transcript, run a pack, view structured noul/choice/score answers rendered
nicely — not raw JSON); batch analysis (pick center + count, run pack, show
per-question aggregates).

====================================================================
IMPLEMENTATION NOTES / GOTCHAS
====================================================================
- Schema is defined as a JS template literal (backtick string). SQL `--` comments
  inside it MUST NOT contain backticks (they terminate the literal).
- timeseries endpoints must emit full ISO-8601 strings WITH 'T' and 'Z'
  (e.g. "2026-10-03T16:00:00Z"). "YYYY-MM-DD HH" (space + no seconds) makes
  `new Date(...)` return Invalid Date and breaks charts.
- Map topic slugs to grammar prefixes (e.g. "technical-support" -> "tech",
  "order-status" -> "order") to avoid silent fallback to a default script.
- Observable Plot 0.6.x has no pie/donut mark; render donuts as hand-rolled SVG.
- Agents seeded without statuses take many ticks to become 'available'; seed the
  24/7 center's agents with an initial 'available'/'on_break' agent_status.
- Use better-sqlite3 with foreign_keys=ON and journal_mode=WAL.
- .env is gitignored; provide .env.example (PORT, DB_PATH, TYPESAFE_*, LIVE_*).

Deliver a working app: `npm install`, `npm run seed`, `npm run dev:all`, open the
Vite URL. Build must pass (`npm run build`). Follow these requirements exactly;
do not add pre-aggregation tables or persist JEV outputs.
