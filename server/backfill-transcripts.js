// Backfill transcripts for existing calls that don't yet have turns.
// Run with `npm run backfill-transcripts` after upgrading an existing database.
//
// Uses call_turn's presence per call: calls with no turn rows get a full
// transcript generated from their `topic`, `outcome` and durations.

import dotenv from 'dotenv'
import { db } from './db.js'
import { generateTurns } from './conversation.js'

dotenv.config()

const insertTurn = db.prepare(
  'INSERT INTO call_turn (call_id, seq, speaker, text, offset_seconds) VALUES (?, ?, ?, ?, ?)',
)
const companyOf = db.prepare(
  `SELECT co.name AS company_name FROM call c
   JOIN call_center cc ON cc.id = c.call_center_id
   JOIN company co ON co.id = cc.company_id
   WHERE c.id = ?`,
)

const missing = db
  .prepare(
    `SELECT c.id, c.topic, c.mood, c.persona, c.product, c.outcome, c.wait_seconds, c.talk_seconds
     FROM call c
     WHERE NOT EXISTS (SELECT 1 FROM call_turn t WHERE t.call_id = c.id)`,
  )
  .all()

const tx = db.transaction(() => {
  for (const call of missing) {
    const company = companyOf.get(call.id)
    const turns = generateTurns(call.id, {
      topic: call.topic,
      mood: call.mood,
      persona: call.persona,
      product: call.product,
      outcome: call.outcome,
      talk_seconds: call.talk_seconds,
      wait_seconds: call.wait_seconds,
      company: company?.company_name || 'Support',
    })
    turns.forEach((t, i) => {
      insertTurn.run(call.id, i + 1, t.speaker, t.text, t.offset_seconds)
    })
  }
})

tx()
console.log(`Backfilled transcripts for ${missing.length} calls.`)