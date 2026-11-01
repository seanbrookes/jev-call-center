// Seed sample data: companies across timezones, call centers, queues, agents
// (company-scoped, associated with one or more call centers of that company),
// and a week of simulated raw calls + agent-status events.
//
// Run with `npm run seed`. Idempotent-ish: skips if companies already exist.

import dotenv from 'dotenv'
import { db } from './db.js'
import { simulate } from './generator.js'

dotenv.config()

const companies = [
  { name: 'Acme Retail', timezone: 'America/New_York' },
  { name: 'Pacific Telecom', timezone: 'America/Los_Angeles' },
  { name: 'EuroBank', timezone: 'Europe/London' },
  { name: 'AsiaTech Support', timezone: 'Asia/Tokyo' },
  { name: 'Global Support', timezone: 'UTC' },
]

// [company index, name, timezone, open, close, calls/hr, days of week]
// Note: open/close are minutes since local midnight; close=1440 (24:00) means
// "always open".
const centers = [
  [0, 'Acme NYC Support', 'America/New_York', 540, 1080, 80, '1,2,3,4,5'],
  [0, 'Acme Chicago Support', 'America/Chicago', 480, 1020, 55, '1,2,3,4,5'],
  [1, 'PT LA Sales', 'America/Los_Angeles', 540, 1020, 60, '1,2,3,4,5'],
  [1, 'PT Seattle Support', 'America/Los_Angeles', 480, 1140, 40, '1,2,3,4,5,6'],
  [2, 'EuroBank London Desk', 'Europe/London', 480, 1080, 70, '1,2,3,4,5'],
  [2, 'EuroBank Dublin Desk', 'Europe/Dublin', 480, 1020, 35, '1,2,3,4,5'],
  [3, 'AsiaTech Tokyo Support', 'Asia/Tokyo', 540, 1140, 90, '1,2,3,4,5,6'],
  // Always-on test center so the live simulator always has traffic.
  [4, 'Global 24/7 Support', 'UTC', 0, 1440, 30, '1,2,3,4,5,6,7'],
]

const agentNames = [
  'Ava', 'Liam', 'Noah', 'Emma', 'Olivia', 'James', 'Mia', 'Lucas', 'Sophia',
  'Ethan', 'Isabella', 'Mason', 'Amelia', 'Logan', 'Harper', 'Elijah', 'Evelyn',
]

function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM company').get().n > 0) {
    console.log('Database already has companies — skipping seed.')
    process.exit(0)
  }

  const insCompany = db.prepare('INSERT INTO company (name, timezone) VALUES (?, ?)')
  const insCenter = db.prepare(
    `INSERT INTO call_center
       (company_id, name, timezone, open_time, close_time, base_calls_per_hour, days_of_week)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const insQueue = db.prepare(
    'INSERT INTO queue (call_center_id, number, name) VALUES (?, ?, ?)',
  )
  const insAgent = db.prepare(
    'INSERT INTO agent (company_id, name, avg_handle_seconds) VALUES (?, ?, ?)',
  )
  const insAcc = db.prepare(
    'INSERT INTO agent_call_center (agent_id, call_center_id) VALUES (?, ?)',
  )

  const companyIds = companies.map((c) => insCompany.run(c.name, c.timezone).lastInsertRowid)
  const centerIds = []

  const seedTx = db.transaction(() => {
    centers.forEach(([ci, name, timezone, open, close, cph, days], idx) => {
      const centerId = insCenter.run(companyIds[ci], name, timezone, open, close, cph, days)
        .lastInsertRowid

      // Every center has a primary queue; add a secondary for a couple of them
      // to exercise the multi-queue case.
      insQueue.run(centerId, `+1-800-555-${String(1000 + idx)}`, 'Main')
      if (idx % 3 === 0) insQueue.run(centerId, `+1-800-555-${String(9000 + idx)}`, 'Billing')

      // 6 agents per center, all belonging to the center's company.
      const agentIds = []
      for (let i = 0; i < 6; i++) {
        const aname = `${agentNames[(idx * 6 + i) % agentNames.length]}-${idx + 1}`
        agentIds.push(
          insAgent.run(companyIds[ci], aname, 180 + ((idx + i) % 5) * 60).lastInsertRowid,
        )
        insAcc.run(agentIds[agentIds.length - 1], centerId)
      }

      // Demonstrate the many-to-many nature: spread each agent across a second
      // center of the SAME company when one exists, so agents can be logged in
      // to several queues of one company.
      const sibling = centers
        .map((c, i) => [i, c[0]])
        .filter(([i, c0]) => c0 === ci && i !== idx)
        .map(([i]) => i)
      if (sibling.length) {
        const siblingIdx = sibling[0]
        const siblingCenterId = centerIds[siblingIdx]
        agentIds.slice(0, 3).forEach((a) => {
          if (siblingCenterId) insAcc.run(a, siblingCenterId)
        })
      }
      centerIds[idx] = centerId
    })
  })

  seedTx()

  const companyIdCount = companyIds.length
  const centerCount = centerIds.length

  // Generate a week of raw history (calls + agent status).
  const end = new Date()
  const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000)
  const generated = simulate(start, end, (p) =>
    console.log(`[seed] simulated ${p.generated} calls`),
  )

  console.log(
    `Seeded ${companyIdCount} companies, ${centerCount} call centers, ${generated} calls.`,
  )
}

seed()