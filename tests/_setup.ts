/**
 * Test setup: runs first in every test file (import it before any src module).
 * Points the app at a throwaway data dir so tests never touch the real
 * database, and pins the env the libraries read at import time.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nearhr-test-"));
process.chdir(dir);

process.env.VAULT_APP_SECRET = "test-app-secret";
process.env.APP_URL = "http://localhost:3000";
process.env.NEAR_NETWORK = "testnet";

export const TMP_DIR = dir;
