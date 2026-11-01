import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { SCHEMA } from './schema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const dbPath = path.resolve(ROOT, process.env.DB_PATH || './jev-call-center.db')

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(SCHEMA)

export { ROOT }