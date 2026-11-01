// Add the "Global 24/7 Support" call center to an EXISTING database without
// touching any other data (non-destructive, idempotent).
//
// Run with `npm run add-247-center`. Safe to run more than once — it no-ops if
// the center already exists. Creates the company (if absent), the always-open
// center, two queues, six agents (linked via agent_call_center), and seeds an
// initial agent_status so the live simulator answers calls immediately.

import dotenv from 'dotenv'
import { db } from './db.js'

dotenv.config()

const CENTER_NAME = 'Global 24/7 Support'
const COMPANY_NAME = 'Global Support'

function run() {
  const get = (sql, ...a) => db.prepare(sql).get(...a)

  if (get('SELECT id FROM call_center WHERE name = ?', CENTER_NAME)) {
    console.log(`"${CENTER_NAME}" already exists — nothing to do.`)
    return
  }

  const tx = db.transaction(() => {
    // Find or create the company.
    let companyId = get('SELECT id FROM company WHERE name = ?', COMPANY_NAME)?.id
    if (!companyId) {
      companyId = db
        .prepare('INSERT INTO company (name, timezone) VALUES (?, ?)')
        .run(COMPANY_NAME, 'UTC').lastInsertRowid
    }

    const centerId = db
      .prepare(
        `INSERT INTO call_center
           (company_id, name, timezone, open_time, close_time, base_calls_per_hour, days_of_week)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(companyId, CENTER_NAME, 'UTC', 0, 1440, 30, '1,2,3,4,5,6,7').lastInsertRowid

    // Queues.
    const insQueue = db.prepare('INSERT INTO queue (call_center_id, number, name) VALUES (?, ?, ?)')
    insQueue.run(centerId, '+1-800-555-2470', 'Main')
    insQueue.run(centerId, '+1-800-555-2471', 'Billing')

    // Agents + association, plus an initial status so the simulator answers now.
    const insAgent = db.prepare('INSERT INTO agent (company_id, name, avg_handle_seconds) VALUES (?, ?, ?)')
    const insAcc = db.prepare('INSERT INTO agent_call_center (agent_id, call_center_id) VALUES (?, ?)')
    const insStatus = db.prepare(
      'INSERT INTO agent_status (agent_id, call_center_id, status, from_ts) VALUES (?, ?, ?, ?)',
    )
    const names = ['Jordan', 'Taylor', 'Morgan', 'Riley', 'Casey', 'Avery']
    const nowIso = new Date().toISOString()

    names.forEach((n, i) => {
      const agentId = insAgent.run(companyId, `${n}-24x7`, 180 + (i % 5) * 60).lastInsertRowid
      insAcc.run(agentId, centerId)
      // 5 available, 1 on_break to give immediate, realistic occupancy.
      insStatus.run(agentId, centerId, i === 5 ? 'on_break' : 'available', nowIso)
    })

    return centerId
  })

  const centerId = tx()
  console.log(`Added "${CENTER_NAME}" (call_center id ${centerId}) with 6 agents and 2 queues.`)
}

run()