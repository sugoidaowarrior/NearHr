/**
 * SQLite persistence (better-sqlite3). File lives in data/nearhr.db
 * (gitignored). KMS key auto-generated on first run into data/kms.key.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "nearhr.db");
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
      near_account    TEXT,                      -- employee NEAR account to pay
      status          TEXT NOT NULL DEFAULT 'pending', -- pending|executed|failed
      tx_ref          TEXT,                      -- near tx hash of the payroll payout (plain transfer)
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

    -- Short-lived OAuth PKCE state -> verifier (10-minute TTL, single use)
    CREATE TABLE IF NOT EXISTS oauth_states (
      state           TEXT PRIMARY KEY,
      verifier        TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at      TEXT NOT NULL
    );

    -- Employee directory (employer-managed roster)
    CREATE TABLE IF NOT EXISTS employees (
      id              TEXT PRIMARY KEY,
      employer_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      email           TEXT,
      department      TEXT,
      job_title       TEXT,
      wallet          TEXT,                          -- NEAR account address to pay
      asset           TEXT NOT NULL DEFAULT 'NEAR',  -- NEAR | USDC
      salary          TEXT NOT NULL DEFAULT '0',     -- human amount per pay period
      frequency       TEXT NOT NULL DEFAULT 'monthly', -- monthly | biweekly | weekly
      pay_day         INTEGER,                       -- day of month for monthly (1..28)
      status          TEXT NOT NULL DEFAULT 'active', -- active | offboarded
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Payment ledger: every payout (payroll run line items OR one-off sends)
    CREATE TABLE IF NOT EXISTS payments (
      id              TEXT PRIMARY KEY,
      employer_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      employee_id     TEXT REFERENCES employees(id) ON DELETE SET NULL,
      recipient_name  TEXT,
      recipient_wallet TEXT,
      kind            TEXT NOT NULL,                 -- payroll | send
      asset           TEXT NOT NULL,
      amount          TEXT NOT NULL,                 -- human amount
      note            TEXT,
      tx_ref          TEXT,
      status          TEXT NOT NULL DEFAULT 'sent',  -- sent | pending | failed
      paid_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Payroll reminder schedule (payday + when HR gets reminded)
    CREATE TABLE IF NOT EXISTS payroll_schedules (
      employer_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      frequency       TEXT NOT NULL DEFAULT 'monthly', -- monthly | biweekly | weekly
      pay_day         INTEGER NOT NULL DEFAULT 28,
      reminder_days   INTEGER NOT NULL DEFAULT 3,
      remind_email    TEXT,
      active          INTEGER NOT NULL DEFAULT 1,
      next_due        TEXT,                          -- date (YYYY-MM-DD)
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_items_run ON payroll_items(run_id);
    CREATE INDEX IF NOT EXISTS idx_runs_employer ON payroll_runs(employer_id);
    CREATE INDEX IF NOT EXISTS idx_emp_employer ON employees(employer_id);
    CREATE INDEX IF NOT EXISTS idx_pay_employer ON payments(employer_id);
    CREATE INDEX IF NOT EXISTS idx_pay_employee ON payments(employee_id);
  `);

  // One-off migrations (safe to run every boot: no-op when already migrated).
  // Amounts exceed 2^63 (1 NEAR = 10^24 yocto) — SQLite INTEGER overflows to
  // REAL and silently corrupts the value, so they must live in TEXT columns.
  const ver = (db.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;
  if (ver < 2) {
    // Every user is an HR operator of their own workspace: no role selection.
    db.exec(`UPDATE users SET role = 'employer' WHERE role IS NOT 'employer'`);
    // Clear imported Google photos so the default monogram pfp shows until the
    // user chooses their own image.
    db.exec(`UPDATE users SET avatar = NULL`);
    db.prepare("PRAGMA user_version = 2").run();
  }
  if (ver < 3) {
    // Default monogram pfp style (A = blue gradient initials, B = solid hue).
    const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "pfp_style")) {
      db.exec("ALTER TABLE users ADD COLUMN pfp_style TEXT DEFAULT 'A'");
    }
    db.prepare("PRAGMA user_version = 3").run();
  }
  if (ver < 5) {
    // Optional profile photo per employee (data URL), set when adding a person.
    const empCols = db.prepare("PRAGMA table_info(employees)").all() as { name: string }[];
    if (!empCols.some((c) => c.name === "avatar")) {
      db.exec("ALTER TABLE employees ADD COLUMN avatar TEXT");
    }
    db.prepare("PRAGMA user_version = 5").run();
  }
  if (ver < 6) {
    // Chosen display currency for the employer's own dashboard (NGN/USD/EUR).
    // Picked at first sign in; the amount widgets render in this currency.
    const uCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    if (!uCols.some((c) => c.name === "display_currency")) {
      db.exec("ALTER TABLE users ADD COLUMN display_currency TEXT NOT NULL DEFAULT 'NGN'");
    }
    db.prepare("PRAGMA user_version = 6").run();
  }
  if (ver < 7) {
    // Invoicing: open invoices an employer issues to a client, settled on NEAR.
    db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        employer_id TEXT NOT NULL,
        client_name TEXT NOT NULL,
        client_email TEXT,
        note TEXT,
        items_json TEXT NOT NULL DEFAULT '[]',
        amount TEXT NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        quote_ref TEXT,
        deposit_address TEXT,
        deposit_deadline TEXT,
        payer_asset TEXT,
        payer_amount TEXT,
        near_tx TEXT,
        settled_at TEXT,
        relayer_tx TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_invoices_employer ON invoices(employer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_invoices_slug ON invoices(slug);
    `);
    db.prepare("PRAGMA user_version = 7").run();
  }

  if (ver < 8) {
    // Record the payer's wallet account id when they claim payment, so the
    // server can re poll the tx RPC by hash later (hash lookups need a sender).
    db.exec(`ALTER TABLE invoices ADD COLUMN payer_account TEXT`);
    db.prepare("PRAGMA user_version = 8").run();
  }
  if (ver < 9) {
    // The token the invoice is billed in: "USDC" or "NEAR". The payer pays in
    // exactly this token; the server verifies the matching on chain credit.
    db.exec(`ALTER TABLE invoices ADD COLUMN asset TEXT NOT NULL DEFAULT 'USDC'`);
    db.prepare("PRAGMA user_version = 9").run();
  }
  if (ver < 10) {
    // Walletless payer accounts: a customer without a NEAR wallet signs in with
    // Google and NearHr provisions a smart account for them (ed25519 key stored
    // encrypted, implicit NEAR address). Email is only the sign in method; the
    // account holds no money until the customer funds it.
    db.exec(`
      CREATE TABLE IF NOT EXISTS payer_accounts (
        user_id      TEXT PRIMARY KEY,
        near_account TEXT NOT NULL,
        record       TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_payer_accounts_user ON payer_accounts(user_id);
    `);
    const osCols = db.prepare("PRAGMA table_info(oauth_states)").all() as { name: string }[];
    if (!osCols.some((c) => c.name === "next_url")) {
      db.exec("ALTER TABLE oauth_states ADD COLUMN next_url TEXT");
    }
    db.prepare("PRAGMA user_version = 10").run();
  }
  if (ver < 11) {
    // Refund receipt: the tx that returned a paid invoice's money to the
    // payer. refund_at is the ISO time of that on chain transfer.
    const invCols = db.prepare("PRAGMA table_info(invoices)").all() as { name: string }[];
    if (!invCols.some((c) => c.name === "refund_tx")) {
      db.exec("ALTER TABLE invoices ADD COLUMN refund_tx TEXT");
    }
    if (!invCols.some((c) => c.name === "refund_at")) {
      db.exec("ALTER TABLE invoices ADD COLUMN refund_at TEXT");
    }
    db.prepare("PRAGMA user_version = 11").run();
  }
  if (ver < 12) {
    // On chain registry receipt: whether the invoice contract holds this
    // invoice (chain_status "recorded"), whether a best effort write failed
    // and is waiting for a retry ("pending"), or null when the contract is
    // not configured or the invoice's asset is not registered. chain_tx is
    // the explorer hash of the write that recorded it.
    const invCols = db.prepare("PRAGMA table_info(invoices)").all() as { name: string }[];
    if (!invCols.some((c) => c.name === "chain_status")) {
      db.exec("ALTER TABLE invoices ADD COLUMN chain_status TEXT");
    }
    if (!invCols.some((c) => c.name === "chain_tx")) {
      db.exec("ALTER TABLE invoices ADD COLUMN chain_tx TEXT");
    }
    db.prepare("PRAGMA user_version = 12").run();
  }
  // Drop legacy columns by rebuilding any table whose live schema still
  // carries them (idempotent: a clean database matches the whitelist exactly,
  // so the rebuild is a no-op). The whitelist is the set of column names that
  // follow a leading whitespace in the CREATE below.
  const ID = /^([a-z][a-z0-9_]*)\b/;
  const columnNames = (create: string): string[] => {
    const out: string[] = [];
    for (const line of create.split("\n")) {
      // First token of the line; skip the leading CREATE TABLE line.
      const m = line.match(ID);
      if (m && !line.trimStart().startsWith("CREATE")) out.push(m[1]);
    }
    return out;
  };
  const rebuildTable = (table: string, create: string, select: string, index: string) => {
    const live = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
    );
    const keep = columnNames(create);
    // No rebuild needed when the live table has exactly the kept columns.
    if (keep.length && live.size === keep.length && keep.every((c) => live.has(c))) return;
    db.exec(`CREATE TABLE ${table}_new (${create});`);
    db.exec(`INSERT INTO ${table}_new SELECT ${select} FROM ${table};`);
    db.exec(`DROP TABLE ${table};`);
    db.exec(`ALTER TABLE ${table}_new RENAME TO ${table};`);
    db.exec(index);
  };

  rebuildTable(
    "payroll_items",
    `id              TEXT PRIMARY KEY,
      run_id          TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
      recipient_email TEXT NOT NULL,
      recipient_name  TEXT,
      amount_yocto    TEXT NOT NULL DEFAULT '0',
      near_account    TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      tx_ref          TEXT,
      error           TEXT,
      executed_at     TEXT`,
    "id, run_id, recipient_email, recipient_name, CAST(amount_yocto AS TEXT), near_account, status, tx_ref, error, executed_at",
    "CREATE INDEX idx_items_run ON payroll_items(run_id);"
  );

  rebuildTable(
    "payroll_runs",
    `id              TEXT PRIMARY KEY,
      employer_id     TEXT NOT NULL REFERENCES users(id),
      name            TEXT NOT NULL,
      asset           TEXT NOT NULL,
      usdc_contract   TEXT,
      status          TEXT NOT NULL DEFAULT 'draft',
      total_yocto     TEXT NOT NULL DEFAULT '0',
      employee_count  INTEGER NOT NULL DEFAULT 0,
      near_ref        TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      executed_at     TEXT`,
    "id, employer_id, name, asset, usdc_contract, status, CAST(total_yocto AS TEXT), employee_count, near_ref, created_at, executed_at",
    "CREATE INDEX idx_runs_employer ON payroll_runs(employer_id);"
  );

  rebuildTable(
    "employees",
    `id              TEXT PRIMARY KEY,
      employer_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      email           TEXT,
      department      TEXT,
      job_title       TEXT,
      wallet          TEXT,
      asset           TEXT NOT NULL DEFAULT 'NEAR',
      salary          TEXT NOT NULL DEFAULT '0',
      frequency       TEXT NOT NULL DEFAULT 'monthly',
      pay_day         INTEGER,
      status          TEXT NOT NULL DEFAULT 'active',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      avatar          TEXT`,
    "id, employer_id, name, email, department, job_title, wallet, asset, salary, frequency, pay_day, status, created_at, updated_at, avatar",
    "CREATE INDEX idx_emp_employer ON employees(employer_id);"
  );

  console.log("[db] ready at", DB_PATH);
}

export function getDb(): Database.Database {
  if (!db) initDb();
  return db;
}
