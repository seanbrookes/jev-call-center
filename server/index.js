import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { db } from './db.js'
import { simulate, tick, TOPICS } from './generator.js'
import { MOODS, PERSONAS, PRODUCTS } from './conversation.js'
import { QUESTION_SETS, listQuestionSets } from './jev-questions.js'
import * as jev from './jev.js'

// Small concurrency pool so batch analysis doesn't run every call serially.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 3101

const all = (sql, ...args) => db.prepare(sql).all(...args)
const run = (sql, ...args) => db.prepare(sql).run(...args)
const get = (sql, ...args) => db.prepare(sql).get(...args)

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------
app.get('/api/companies', (_req, res) => res.json(all('SELECT * FROM company ORDER BY id')))

app.post('/api/companies', (req, res) => {
  const { name, timezone = 'UTC' } = req.body
  const info = run('INSERT INTO company (name, timezone) VALUES (?, ?)', name, timezone)
  res.json({ id: info.lastInsertRowid })
})

// ---------------------------------------------------------------------------
// Call centers
// ---------------------------------------------------------------------------
app.get('/api/call-centers', (req, res) => {
  const companyId = req.query.companyId
  if (companyId) {
    res.json(all('SELECT * FROM call_center WHERE company_id = ? ORDER BY id', companyId))
  } else {
    res.json(all('SELECT * FROM call_center ORDER BY id'))
  }
})

app.post('/api/call-centers', (req, res) => {
  const {
    company_id, name, timezone = 'UTC', open_time = 540, close_time = 1020,
    base_calls_per_hour = 30, days_of_week = '1,2,3,4,5',
  } = req.body
  run(
    `INSERT INTO call_center
       (company_id, name, timezone, open_time, close_time, base_calls_per_hour, days_of_week)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    company_id, name, timezone, open_time, close_time, base_calls_per_hour, days_of_week,
  )
  res.status(201).json({ ok: true })
})

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------
app.get('/api/queues', (req, res) => {
  const centerId = req.query.centerId
  if (centerId) {
    res.json(all('SELECT * FROM queue WHERE call_center_id = ? ORDER BY id', centerId))
  } else {
    res.json(all('SELECT * FROM queue ORDER BY id'))
  }
})

// ---------------------------------------------------------------------------
// Agents (company-scoped, many-to-many with call centers)
// ---------------------------------------------------------------------------
app.get('/api/agents', (req, res) => {
  const centerId = req.query.centerId
  if (centerId) {
    res.json(
      all(
        `SELECT a.* FROM agent a
         JOIN agent_call_center acc ON acc.agent_id = a.id
         WHERE acc.call_center_id = ? ORDER BY a.id`,
        centerId,
      ),
    )
  } else {
    res.json(all('SELECT * FROM agent ORDER BY id'))
  }
})

app.get('/api/agents/:id/centers', (req, res) => {
  res.json(
    all(
      `SELECT cc.* FROM call_center cc
       JOIN agent_call_center acc ON acc.call_center_id = cc.id
       WHERE acc.agent_id = ? ORDER BY cc.id`,
      req.params.id,
    ),
  )
})

// ---------------------------------------------------------------------------
// Agent status (raw, append-only events)
// ---------------------------------------------------------------------------
app.get('/api/agent-statuses', (req, res) => {
  const centerId = req.query.centerId
  const limit = Math.min(Number(req.query.limit) || 500, 5000)
  if (centerId) {
    res.json(
      all(
        `SELECT * FROM agent_status WHERE call_center_id = ?
         ORDER BY from_ts DESC LIMIT ${limit}`,
        centerId,
      ),
    )
  } else {
    res.json(all(`SELECT * FROM agent_status ORDER BY from_ts DESC LIMIT ${limit}`))
  }
})

// ---------------------------------------------------------------------------
// Calls (raw, append-only)
// ---------------------------------------------------------------------------
app.get('/api/calls', (req, res) => {
  const centerId = req.query.centerId
  const from = req.query.from
  const to = req.query.to
  const limit = Math.min(Number(req.query.limit) || 1000, 10000)

  const conds = []
  const args = []
  if (centerId) { conds.push('call_center_id = ?'); args.push(centerId) }
  if (from) { conds.push('started_at >= ?'); args.push(from) }
  if (to) { conds.push('started_at < ?'); args.push(to) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

  res.json(all(`SELECT * FROM call ${where} ORDER BY started_at DESC LIMIT ${limit}`, ...args))
})

// Transcript for a single call (raw ordered turns).
app.get('/api/calls/:id/transcript', (req, res) => {
  const turns = all(
    'SELECT seq, speaker, text, offset_seconds FROM call_turn WHERE call_id = ? ORDER BY seq',
    req.params.id,
  )
  res.json({ call_id: Number(req.params.id), turns })
})

// A single call's full record.
app.get('/api/calls/:id', (req, res) => {
  const call = get('SELECT * FROM call WHERE id = ?', req.params.id)
  if (!call) return res.status(404).json({ error: 'Call not found.' })
  res.json(call)
})

// ---------------------------------------------------------------------------
// Historical simulation (backfill a window of raw calls + agent status)
// ---------------------------------------------------------------------------
app.post('/api/simulate', (req, res) => {
  const { from, to, scenario = {} } = req.body
  const start = from ? new Date(from) : new Date(Date.now() - 60 * 60 * 1000)
  const end = to ? new Date(to) : new Date()

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return res.status(400).json({ error: 'Invalid from/to range.' })
  }

  const generated = simulate(start, end, (p) =>
    console.log(`[simulate] ${p.generated} calls`, p.start.toISOString(), '->', p.end.toISOString()),
    scenario,
  )
  res.json({ generated, scenario, from: start.toISOString(), to: end.toISOString() })
})

// ---------------------------------------------------------------------------
// Live simulation (start/stop, server-driven tick loop)
// ---------------------------------------------------------------------------
const live = {
  running: false,
  timer: null,
  intervalMs: Number(process.env.LIVE_INTERVAL_MS) || 2000,
  lastActivity: Date.now(),
  idleTimeoutMs: Number(process.env.LIVE_IDLE_TIMEOUT_MS) || 60 * 60 * 1000,
  startedAt: null,
  ticks: 0,
  calls: 0,
  scenario: {},
  reason: null,
}

function liveStop(reason = 'stopped') {
  if (live.timer) clearInterval(live.timer)
  live.timer = null
  live.running = false
  live.reason = reason
  console.log(`[live] simulation stopped (${reason})`)
}

function liveTick() {
  live.calls += tick(new Date(), live.scenario)
  live.ticks += 1

  // Kill switch: stop if no user activity within the idle window.
  if (Date.now() - live.lastActivity > live.idleTimeoutMs) {
    liveStop('idle-timeout')
  }
}

app.post('/api/simulate/live/start', (req, res) => {
  if (live.running) return res.json(liveState())
  live.running = true
  live.calls = 0
  live.ticks = 0
  live.startedAt = new Date().toISOString()
  live.lastActivity = Date.now()
  live.scenario = req.body?.scenario || {}
  live.reason = null
  live.timer = setInterval(liveTick, live.intervalMs)
  console.log('[live] simulation started', JSON.stringify(live.scenario))
  res.json(liveState())
})

app.post('/api/simulate/live/stop', (_req, res) => {
  if (live.running) liveStop('stopped')
  res.json(liveState())
})

// Heartbeat resets the idle timer (keeps the kill switch at bay while the user
// is actively watching the page).
app.post('/api/simulate/live/heartbeat', (_req, res) => {
  live.lastActivity = Date.now()
  res.json({ ok: true })
})

function liveState() {
  return {
    running: live.running,
    startedAt: live.startedAt,
    ticks: live.ticks,
    calls: live.calls,
    intervalMs: live.intervalMs,
    idleTimeoutMs: live.idleTimeoutMs,
    lastActivity: live.lastActivity,
    scenario: live.scenario,
    reason: live.reason,
  }
}

app.get('/api/simulate/live/state', (_req, res) => res.json(liveState()))

// Scenario options: the catalogs a UI can present for configuring simulation.
app.get('/api/scenario/options', (_req, res) => {
  res.json({
    topics: TOPICS,
    moods: MOODS,
    personas: PERSONAS,
    products: PRODUCTS,
  })
})

// ---------------------------------------------------------------------------
// Analytics (computed ON DEMAND from raw data — nothing pre-aggregated)
// ---------------------------------------------------------------------------

// Leaderboard: per-call-center metrics derived from raw `call` rows.
app.get('/api/analytics/leaderboard', (_req, res) => {
  res.json(
    all(
      `SELECT c.id AS call_center_id,
              c.name AS call_center,
              c.company_id,
              co.name AS company,
              COUNT(*) AS calls,
              SUM(call.outcome = 'answered')                                   AS answered,
              SUM(call.outcome = 'abandoned')                                  AS abandoned,
              ROUND(100.0 * SUM(call.outcome = 'abandoned') / COUNT(*), 2)     AS abandonment_pct,
              ROUND(AVG(CASE WHEN call.outcome = 'answered' THEN call.wait_seconds END), 1) AS avg_wait,
              ROUND(AVG(CASE WHEN call.outcome = 'answered' THEN call.talk_seconds END), 1) AS avg_talk
       FROM call
       JOIN call_center c   ON c.id = call.call_center_id
       JOIN company     co  ON co.id = c.company_id
       GROUP BY c.id
       ORDER BY calls DESC`,
    ),
  )
})

// Time-series grouped by (configurable) bucket from raw `call` rows.
// bucket = 'hour' | 'minute' (default 'hour').
app.get('/api/analytics/timeseries', (req, res) => {
  const centerId = req.query.centerId
  const bucket = req.query.bucket === 'minute' ? '%Y-%m-%dT%H:%M:00Z' : '%Y-%m-%dT%H:00:00Z'
  const where = centerId ? 'WHERE call_center_id = ?' : ''
  const args = centerId ? [centerId] : []
  res.json(
    all(
      `SELECT strftime(?, started_at) AS time,
              COUNT(*) AS calls,
              SUM(outcome = 'answered')   AS answered,
              SUM(outcome = 'abandoned')  AS abandoned,
              SUM(outcome = 'voicemail')  AS voicemail,
              ROUND(AVG(CASE WHEN outcome = 'answered' THEN wait_seconds END), 1) AS avg_wait,
              ROUND(AVG(CASE WHEN outcome = 'answered' THEN talk_seconds END), 1) AS avg_talk
       FROM call ${where}
       GROUP BY time ORDER BY time`,
      bucket,
      ...args,
    ),
  )
})

// Topic distribution (derived from raw call.topic).
app.get('/api/analytics/topics', (req, res) => {
  res.json(
    all(
      `SELECT topic AS key, COUNT(*) AS value FROM call
       WHERE topic IS NOT NULL GROUP BY topic ORDER BY value DESC`,
    ),
  )
})

// Outcome distribution (derived from raw call.outcome).
app.get('/api/analytics/outcomes', (req, res) => {
  res.json(
    all(`SELECT outcome AS key, COUNT(*) AS value FROM call GROUP BY outcome ORDER BY value DESC`),
  )
})

// Current agent occupancy: count agents in each status as of now.
app.get('/api/analytics/agent-occupancy', (_req, res) => {
  res.json(
    all(
      `SELECT s.status, COUNT(*) AS value
       FROM agent_status s
       WHERE s.to_ts IS NULL
       GROUP BY s.status ORDER BY value DESC`,
    ),
  )
})

// Per call center, per hour bucket, call counts — for 3D / cross-center slicing.
// Bucket: 'hour' (default) or 'day'. Window defaults to the last 7 days.
app.get('/api/analytics/volume-grid', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90)
  const bucket = req.query.bucket === 'day' ? 'day' : 'hour'
  const fmt = bucket === 'day' ? '%Y-%m-%dT00:00:00Z' : '%Y-%m-%dT%H:00:00Z'
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
  res.json({
    bucket,
    days,
    since,
    rows: all(
      `SELECT call.call_center_id,
              c.name AS call_center,
              strftime(?, call.started_at) AS time,
              COUNT(*) AS calls,
              SUM(call.outcome = 'answered')   AS answered,
              SUM(call.outcome = 'abandoned')  AS abandoned
       FROM call
       JOIN call_center c ON c.id = call.call_center_id
       WHERE call.started_at >= ?
       GROUP BY call.call_center_id, time
       ORDER BY time, call.call_center_id`,
      fmt,
      since,
    ),
  })
})

// ---------------------------------------------------------------------------
// JEV
// ---------------------------------------------------------------------------
app.get('/api/jev/status', (_req, res) => res.json(jev.status()))

app.post('/api/jev/evaluate', async (req, res) => {
  try {
    const { state, questions, model } = req.body
    if (!state) return res.status(400).json({ error: 'Missing state.' })
    if (!questions || typeof questions !== 'object') {
      return res.status(400).json({ error: 'Missing questions map.' })
    }
    const result = await jev.evaluate(state, questions, model)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Available analysis packs (question sets).
app.get('/api/jev/question-sets', (_req, res) => res.json(listQuestionSets()))

// Build a readable transcript string from a call's turns for use as JEV state.
const SPEAKER_LABEL = { caller: 'Caller', agent: 'Agent', ivr: 'System' }
function transcriptText(callId) {
  const turns = all('SELECT speaker, text FROM call_turn WHERE call_id = ? ORDER BY seq', callId)
  return turns.map((t) => `${SPEAKER_LABEL[t.speaker] || t.speaker}: ${t.text}`).join('\n')
}

// Run a question set over one or more calls. Body: { calls: [ids], packId? , questions? }
app.post('/api/jev/analyze', async (req, res) => {
  try {
    const { calls = [], packId = 'call-quality', questions } = req.body
    const qs = questions || QUESTION_SETS[packId]?.questions
    if (!qs) return res.status(400).json({ error: 'Unknown question set.' })
    if (!Array.isArray(calls) || !calls.length) {
      return res.status(400).json({ error: 'Provide an array of call ids.' })
    }

    const ids = calls.slice(0, 100).map(Number)
    const results = (await mapLimit(ids, 5, async (id) => {
      const state = transcriptText(id)
      if (!state) return null
      const out = await jev.evaluate(state, qs)
      return { call_id: id, ...out }
    })).filter(Boolean)

    res.json({ packId, count: results.length, results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

// Aggregate one question's answers into a single time-series-ready scalar.
function aggregateMetric(answers, q) {
  if (!answers.length) return { count: 0, value: null }
  if (q.type === 'noul') {
    const vals = answers.map((a) => a.noul)
    const yesPct = (100 * vals.filter((v) => v > 0.5).length) / vals.length
    return { count: vals.length, value: yesPct, avg: mean(vals) }
  }
  if (q.type === 'score') {
    const vals = answers.map((a) => a.score)
    return { count: vals.length, value: mean(vals) }
  }
  if (q.type === 'choice') {
    const counts = {}
    answers.forEach((a) => { counts[a.choice] = (counts[a.choice] || 0) + 1 })
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    return { count: answers.length, value: top ? (100 * top[1]) / answers.length : 0, top: top?.[0], counts }
  }
  return { count: answers.length, value: null }
}

// Evaluate a question set over calls across a time range, bucketed, so the
// response can be plotted over time. Body:
//   { questions, from, to, bucket: 'day'|'hour', maxPerBucket? }
app.post('/api/jev/timeseries', async (req, res) => {
  try {
    const { questions, from, to, bucket = 'day', maxPerBucket = 40 } = req.body
    if (!questions || typeof questions !== 'object' || !Object.keys(questions).length) {
      return res.status(400).json({ error: 'Provide a questions map.' })
    }
    const start = new Date(from || Date.now() - 7 * 86400000)
    const end = new Date(to || Date.now())
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      return res.status(400).json({ error: 'Invalid from/to range.' })
    }

    const fmt = bucket === 'hour' ? '%Y-%m-%dT%H:00:00Z' : '%Y-%m-%dT00:00:00Z'
    const rows = all(
      `SELECT strftime(?, started_at) AS time, id FROM call
       WHERE started_at >= ? AND started_at < ? ORDER BY started_at`,
      fmt, start.toISOString(), end.toISOString(),
    )

    const buckets = new Map()
    for (const r of rows) {
      if (!buckets.has(r.time)) buckets.set(r.time, { time: r.time, ids: [] })
      buckets.get(r.time).ids.push(r.id)
    }

    const qids = Object.keys(questions)
    const results = []
    for (const [time, b] of buckets) {
      const ids = b.ids.slice(0, maxPerBucket).map(Number)
      const answers = (await mapLimit(ids, 6, async (id) => {
        const state = transcriptText(id)
        if (!state) return null
        return (await jev.evaluate(state, questions)).answers
      })).filter(Boolean)

      const metrics = {}
      for (const qid of qids) {
        metrics[qid] = aggregateMetric(answers.map((a) => a?.[qid]).filter(Boolean), questions[qid])
      }
      results.push({ time, calls: ids.length, metrics })
    }

    res.json({ bucket, from: start.toISOString(), to: end.toISOString(), sampledPerBucket: maxPerBucket, results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`JEV Call Center server listening on http://localhost:${PORT}`)
})