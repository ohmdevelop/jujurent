const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  contact TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  rank TEXT,
  level INTEGER DEFAULT 0,
  region TEXT DEFAULT 'AP',
  agents_count INTEGER DEFAULT 0,
  skins TEXT,
  description TEXT,
  image_url TEXT,
  price_per_hour REAL NOT NULL,
  riot_username TEXT NOT NULL,
  riot_password_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  is_visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  hours INTEGER NOT NULL,
  price_per_hour REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  slip_path TEXT NOT NULL,
  slip_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  admin_note TEXT,
  start_at INTEGER,
  end_at INTEGER,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_slip ON orders(slip_hash);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
for (const [col, type] of [
  ['ticket_channel_id', 'TEXT'],
  ['ticket_channel_name', 'TEXT'],
  ['discord_msg_id', 'TEXT'],
  ['delivered_at', 'INTEGER'],
  ['anydesk_id', 'TEXT'],
  ['remote_status', 'TEXT'],
  ['remote_started_at', 'INTEGER'],
  ['remote_completed_at', 'INTEGER'],
]) {
  if (!orderCols.includes(col)) db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${type}`);
}

module.exports = db;
