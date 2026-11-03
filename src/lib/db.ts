/**
 * SQLite persistence (better-sqlite3). File lives in data/hushpay.db
 * (gitignored). KMS key auto-generated on first run into data/kms.key.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "hushpay.db");
const KMS_PATH = path.join(DATA_DIR, "kms.key");

let db: Database.Database;

export function initDb(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // KMS master key — crypto.kms() reads this file directly on each vault op.
  if (!fs.existsSync(KMS_PATH)) {
    const key = randomBytes(32).toString("hex");
    fs.writeFileSync(KMS_PATH, key, { mode: 0o600 });
    console.log("[db] generated new KMS key at", KMS_PATH);
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,          -- google sub
      email           TEXT NOT NULL UNIQUE,
      name            TEXT,
      avatar          TEXT,
      role            TEXT NOT NULL DEFAULT 'employee',  -- employer | employee
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One vault row per user: encrypted master material (see crypto.ts)
    CREATE TABLE IF NOT EXISTS vaults (
      user_id         TEXT PRIMARY KEY REFERENCES users(id),
      record          TEXT NOT NULL,             -- encrypted vault JSON
      backup_email    TEXT,                      -- where backup bundle was sent
      backup_sent_at  TEXT,
      near_account    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Payroll runs (one row per scheduled/ran payroll)
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id              TEXT PRIMARY KEY,
      employer_id     TEXT NOT NULL REFERENCES users(id),
      name            TEXT NOT NULL,
      asset           TEXT NOT NULL,             -- NEAR | USDC
      usdc_contract   TEXT,                      -- nep141 address when asset=USDC
      privacy         TEXT NOT NULL DEFAULT 'transparent', -- transparent|shielded|compliant
      status          TEXT NOT NULL DEFAULT 'draft',  -- draft|confirmed|executing|done|failed
      total_yocto     TEXT NOT NULL DEFAULT '0',      -- decimal string; > 2^63 overflows INTEGER
      employee_count  INTEGER NOT NULL DEFAULT 0,
      near_ref        TEXT,                      -- last tx hash / intent id
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      executed_at     TEXT
    );

    -- Line items of a payroll run (per employee)
    CREATE TABLE IF NOT EXISTS payroll_items (
      id              TEXT PRIMARY KEY,
      run_id          TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
      recipient_email TEXT NOT NULL,
      recipient_name  TEXT,
      amount_yocto    TEXT NOT NULL DEFAULT '0',      -- decimal string (yocto/base units)
      privacy         TEXT NOT NULL,             -- per-item override or inherited
      stealth_addr    TEXT,                      -- sip:near:... encoded meta address
      near_account    TEXT,                      -- employee NEAR account (transparent mode)
      status          TEXT NOT NULL DEFAULT 'pending', -- pending|executed|failed
      tx_ref          TEXT,                      -- 1Click intent id / near tx hash
      error           TEXT,
      executed_at     TEXT
    );

    -- Simple session store (server-side sessions, cookie = token)
    CREATE TABLE IF NOT EXISTS sessions (
      token           TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_run ON payroll_items(run_id);
    CREATE INDEX IF NOT EXISTS idx_runs_employer ON payroll_runs(employer_id);
  `);

  // One-off migrations (safe to run every boot: no-op when already migrated).
  // Amounts exceed 2^63 (1 NEAR = 10^24 yocto) — SQLite INTEGER overflows to
  // REAL and silently corrupts the value, so they must live in TEXT columns.
  const itemCols = db.prepare("PRAGMA table_info(payroll_items)").all() as {
    name: string;
    type: string;
  }[];
  if (!itemCols.some((c) => c.name === "near_account")) {
    db.exec("ALTER TABLE payroll_items ADD COLUMN near_account TEXT");
  }
  if (itemCols.some((c) => c.name === "amount_yocto" && c.type === "INTEGER")) {
    db.exec(`
      CREATE TABLE payroll_items_new (
        id              TEXT PRIMARY KEY,
        run_id          TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        recipient_email TEXT NOT NULL,
        recipient_name  TEXT,
        amount_yocto    TEXT NOT NULL DEFAULT '0',
        privacy         TEXT NOT NULL,
        stealth_addr    TEXT,
        near_account    TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        tx_ref          TEXT,
        error           TEXT,
        executed_at     TEXT
      );
      INSERT INTO payroll_items_new SELECT id, run_id, recipient_email, recipient_name,
        CAST(amount_yocto AS TEXT), privacy, stealth_addr, near_account, status, tx_ref, error, executed_at
        FROM payroll_items;
      DROP TABLE payroll_items;
      ALTER TABLE payroll_items_new RENAME TO payroll_items;
      CREATE INDEX idx_items_run ON payroll_items(run_id);
    `);
  }
  const runCols = db.prepare("PRAGMA table_info(payroll_runs)").all() as {
    name: string;
    type: string;
  }[];
  if (runCols.some((c) => c.name === "total_yocto" && c.type === "INTEGER")) {
    db.exec(`
      CREATE TABLE payroll_runs_new (
        id              TEXT PRIMARY KEY,
        employer_id     TEXT NOT NULL REFERENCES users(id),
        name            TEXT NOT NULL,
        asset           TEXT NOT NULL,
        usdc_contract   TEXT,
        privacy         TEXT NOT NULL DEFAULT 'transparent',
        status          TEXT NOT NULL DEFAULT 'draft',
        total_yocto     TEXT NOT NULL DEFAULT '0',
        employee_count  INTEGER NOT NULL DEFAULT 0,
        near_ref        TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        executed_at     TEXT
      );
      INSERT INTO payroll_runs_new SELECT id, employer_id, name, asset, usdc_contract,
        privacy, status, CAST(total_yocto AS TEXT), employee_count, near_ref, created_at, executed_at
        FROM payroll_runs;
      DROP TABLE payroll_runs;
      ALTER TABLE payroll_runs_new RENAME TO payroll_runs;
      CREATE INDEX idx_runs_employer ON payroll_runs(employer_id);
    `);
  }

  console.log("[db] ready at", DB_PATH);
}

export function getDb(): Database.Database {
  if (!db) initDb();
  return db;
}
