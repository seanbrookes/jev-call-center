// Simulation engine: generates raw, append-only `call` and `agent_status`
// records. No pre-aggregation — everything is written as it is simulated.
//
// Two modes build on the same core:
//   - historical: simulate(start, end) backfills a past window
//   - live:       tick() advances a tiny step from "now"; the live server
//                 calls it on a timer.
//
// Agent lifecycle (statuses, extensible):  logged_out, available, on_call,
// wrap_up, on_break, meal_break, training. Each event has from_ts/to_ts.

import { db } from './db.js'
import {
  randomInt, gaussian, pick, toIsoUtc, minutesInZone, isOpen,
  localIsoString, utcOffsetMinutes,
} from './time.js'
import { generateTurns, randomMood, randomPersona, randomProduct } from './conversation.js'

export const TOPICS = [
  'billing', 'account', 'technical-support', 'order-status', 'returns',
  'password-reset', 'cancellation', 'product-info', 'complaint', 'upgrade',
]

const AGENT_STATUSES = ['available', 'on_call', 'wrap_up', 'on_break', 'meal_break', 'training', 'logged_out']

// Time-of-day volume curve (peak mid-day).
const HOUR_CURVE = [0.55, 0.8, 1.05, 1.2, 1.15, 1.0, 0.85, 0.7, 0.4, 0.25, 0.15, 0.1, 0.15, 0.25, 0.4, 0.6, 0.85, 1.05, 1.1, 0.9, 0.7, 0.5, 0.4, 0.3]

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function arrivalRate(center, date) {
  const hour = Math.floor(minutesInZone(center.timezone, date) / 60)
  const curve = HOUR_CURVE[hour] ?? 1
  const noise = Math.max(0.2, 1 + gaussian() * 0.25)
  return center.base_calls_per_hour * curve * noise
}

function centersWithQueues() {
  return db
    .prepare(
      `SELECT c.*, co.name AS company_name, co.id AS company_id
       FROM call_center c JOIN company co ON co.id = c.company_id`,
    )
    .all()
    .map((c) => ({
      ...c,
      queues: db.prepare('SELECT * FROM queue WHERE call_center_id = ?').all(c.id),
    }))
}

function agentsForCenter(centerId) {
  return db
    .prepare(
      `SELECT a.* FROM agent a
       JOIN agent_call_center acc ON acc.agent_id = a.id
       WHERE acc.call_center_id = ?`,
    )
    .all(centerId)
}

// Latest open status event (to_ts IS NULL) for an agent, if any.
function currentStatus(agentId) {
  return db
    .prepare('SELECT * FROM agent_status WHERE agent_id = ? AND to_ts IS NULL ORDER BY from_ts DESC')
    .get(agentId)
}

function closeStatus(agentId, atIso) {
  db.prepare('UPDATE agent_status SET to_ts = ? WHERE agent_id = ? AND to_ts IS NULL').run(atIso, agentId)
}

function setStatus(agentId, centerId, status, fromIso) {
  const cur = currentStatus(agentId)
  if (cur && cur.status === status) return // no-op, same state
  if (cur) closeStatus(agentId, fromIso)
  db.prepare(
    'INSERT INTO agent_status (agent_id, call_center_id, status, from_ts) VALUES (?, ?, ?, ?)',
  ).run(agentId, centerId, status, fromIso)
}

const INSERT_CALL = db.prepare(
  `INSERT INTO call
     (company_id, call_center_id, queue_id, agent_id, started_at, local_started_at,
      utc_offset_min, answered_at, ended_at, wait_seconds, talk_seconds,
      outcome, topic, mood, persona, product, satisfaction)
   VALUES (@company_id, @call_center_id, @queue_id, @agent_id, @started_at, @local_started_at,
           @utc_offset_min, @answered_at, @ended_at, @wait_seconds, @talk_seconds,
           @outcome, @topic, @mood, @persona, @product, @satisfaction)`,
)

const INSERT_TURN = db.prepare(
  `INSERT INTO call_turn (call_id, seq, speaker, text, offset_seconds)
   VALUES (?, ?, ?, ?, ?)`,
)

function writeCall(center, queue, date, agent, wait, talk, outcome, scenario = {}) {
  const startedAt = date
  const startedIso = toIsoUtc(startedAt)
  const localStart = localIsoString(center.timezone, startedAt)
  const offsetMin = utcOffsetMinutes(center.timezone, startedAt)

  let answeredAt = null
  let endedAt = null
  let waitSeconds = null
  let talkSeconds = null

  if (outcome === 'answered') {
    waitSeconds = wait
    talkSeconds = talk
    answeredAt = new Date(date.getTime() + wait * 1000)
    endedAt = new Date(answeredAt.getTime() + talk * 1000)
  } else {
    waitSeconds = wait
    endedAt = new Date(date.getTime() + wait * 1000)
  }

  const topic = scenario.topic ?? pick(TOPICS)
  const mood = scenario.mood ?? randomMood()
  const persona = scenario.persona ?? randomPersona()
  const product = 'product' in scenario ? scenario.product : randomProduct(topic)

  const info = INSERT_CALL.run({
    company_id: center.company_id,
    call_center_id: center.id,
    queue_id: queue?.id ?? null,
    agent_id: agent?.id ?? null,
    started_at: startedIso,
    local_started_at: localStart,
    utc_offset_min: offsetMin,
    answered_at: answeredAt ? toIsoUtc(answeredAt) : null,
    ended_at: endedAt ? toIsoUtc(endedAt) : null,
    wait_seconds: waitSeconds,
    talk_seconds: talkSeconds,
    outcome,
    topic,
    mood,
    persona,
    product,
    satisfaction: outcome === 'answered' && Math.random() < 0.4 ? randomInt(1, 5) : null,
  })

  // Generate and persist the conversation transcript for this call.
  const turns = generateTurns(Number(info.lastInsertRowid), {
    topic,
    mood,
    persona,
    product,
    outcome,
    talk_seconds: talkSeconds,
    wait_seconds: waitSeconds,
    company: center.company_name,
  })
  const insertTurn = db.transaction((ts) => {
    ts.forEach((t, i) => {
      INSERT_TURN.run(info.lastInsertRowid, i + 1, t.speaker, t.text, t.offset_seconds)
    })
  })
  insertTurn(turns)
}

// Decide one step (a single minute) of simulation for a given center/date.
// Returns true if any call was generated.
function stepCenter(center, date, scenario = {}) {
  if (!isOpen(center, date)) return false

  // First, advance agent lifecycle for this center.
  for (const agent of agentsForCenter(center.id)) {
    evolveAgent(center, agent, date)
  }

  const perHour = arrivalRate(center, date)
  const pArrival = perHour / 60

  let generated = false
  if (Math.random() < pArrival) {
    const queue = center.queues.length ? pick(center.queues) : null
    generateCall(center, queue, date, scenario)
    generated = true
  }
  if (pArrival > 0.5 && Math.random() < pArrival - 0.5) {
    const queue = center.queues.length ? pick(center.queues) : null
    generateCall(center, queue, date, scenario)
    generated = true
  }
  return generated
}

// Advance an agent's status one step. Callers that were on_call become wrap_up,
// etc. This stochastic model creates a realistic, non-trivial agent stream.
function evolveAgent(center, agent, date) {
  const nowIso = toIsoUtc(date)
  const cur = currentStatus(agent.id)

  if (!cur) {
    // Not yet on duty -> logged_out unless we decide they're clocked in.
    setStatus(agent.id, center.id, 'logged_out', nowIso)
    return
  }

  switch (cur.status) {
    case 'logged_out': {
      if (Math.random() < 0.01) setStatus(agent.id, center.id, 'available', nowIso)
      break
    }
    case 'available': {
      const r = Math.random()
      if (r < 0.03) setStatus(agent.id, center.id, 'on_break', nowIso)
      else if (r < 0.035) setStatus(agent.id, center.id, 'training', nowIso)
      else if (r < 0.04) setStatus(agent.id, center.id, 'meal_break', nowIso)
      else if (r < 0.05) setStatus(agent.id, center.id, 'logged_out', nowIso)
      break
    }
    case 'on_call': {
      // Handled at call end; if call already ended, transition to wrap_up.
      if (Math.random() < 0.5) setStatus(agent.id, center.id, 'wrap_up', nowIso)
      break
    }
    case 'wrap_up': {
      if (Math.random() < 0.5) setStatus(agent.id, center.id, 'available', nowIso)
      break
    }
    case 'on_break':
    case 'training':
    case 'meal_break': {
      if (Math.random() < 0.2) setStatus(agent.id, center.id, 'available', nowIso)
      break
    }
  }
}

// Generate a single call against a center/queue. Agents currently `available`
// answer; otherwise the call abandons or goes to voicemail.
function generateCall(center, queue, date, scenario = {}) {
  const available = agentsForCenter(center.id).filter((a) => currentStatus(a.id)?.status === 'available')

  const nowIso = toIsoUtc(date)

  if (!available.length) {
    const wait = randomInt(20, 180)
    const outcome = Math.random() < 0.8 ? 'abandoned' : 'voicemail'
    writeCall(center, queue, date, null, wait, null, outcome, scenario)
    return
  }

  const agent = pick(available)
  const wait = Math.max(0, randomInt(0, 180) - available.length * 15)
  const abandonChance = 0.02 + Math.min(0.3, wait / 600)

  if (Math.random() < abandonChance) {
    writeCall(center, queue, date, null, wait, null, 'abandoned', scenario)
    return
  }

  const talk = Math.max(30, Math.round(agent.avg_handle_seconds * (0.6 + Math.random() * 0.8)))

  // Put the agent on_call now; the ongoing on_call status is later transitioned
  // to wrap_up by evolveAgent (status stream stays append-only with correct
  // "now" timestamps). The call record itself carries talk_seconds for analytics.
  setStatus(agent.id, center.id, 'on_call', nowIso)

  writeCall(center, queue, date, agent, wait, talk, 'answered', scenario)
}

/**
 * Historical/batch simulation over [start, end).
 * @returns {number} calls generated
 */
export function simulate(start, end, onProgress = () => {}, scenario = {}) {
  const centers = centersWithQueues()
  let generated = 0
  let t = start.getTime()

  while (t < end.getTime()) {
    const now = new Date(t)
    for (const center of centers) {
      if (stepCenter(center, now, scenario)) generated++
    }
    t += 60 * 1000
  }

  onProgress({ start, end, generated })
  return generated
}

/**
 * Live simulation: advance a single "minute" at (or near) wall-clock `now`.
 * The live server calls this repeatedly on a timer and persists events to the
 * same raw tables, so live and historical data live side by side.
 * @returns {number} calls generated this tick
 */
export function tick(now = new Date(), scenario = {}) {
  const centers = centersWithQueues()
  let generated = 0
  for (const center of centers) {
    if (stepCenter(center, now, scenario)) generated++
  }
  return generated
}