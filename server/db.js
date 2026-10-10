"use strict";
const { AsyncLocalStorage } = require("node:async_hooks");
const fs = require("node:fs"),
  path = require("node:path");
const context = new AsyncLocalStorage();
let pool, sqlite;
const testing =
  process.env.NODE_ENV === "test" &&
  !!process.env.TEST_SQLITE_FILE &&
  !process.env.VERCEL;
if (testing) {
  const { DatabaseSync } = require("node:sqlite");
  sqlite = new DatabaseSync(process.env.TEST_SQLITE_FILE);
  sqlite.exec(fs.readFileSync(path.join(__dirname, "test-schema.sql"), "utf8"));
}
const TABLES = new Set([
  "companies",
  "platform_sessions",
  "platform_mfa_replay",
  "platform_audit",
  "tenants",
  "users",
  "sessions",
  "vehicles",
  "bookings",
  "notifications",
  "storage",
  "shares",
  "audit",
  "photos",
  "rate_limits",
]);
function sql(source) {
  let result = "",
    i = 0,
    param = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "'" || c === '"') {
      const quote = c;
      result += c;
      i++;
      while (i < source.length) {
        result += source[i];
        if (source[i++] === quote) {
          if (source[i] === quote) {
            result += source[i++];
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (c === "?") {
      result += "$" + ++param;
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let word = "";
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i]))
        word += source[i++];
      result +=
        (TABLES.has(word.toLowerCase()) && source[i - word.length - 1] !== "."
          ? "pit."
          : "") + word;
      continue;
    }
    result += c;
    i++;
  }
  return result;
}
function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    const e = new Error("Добавьте DATABASE_URL в настройки окружения Vercel");
    e.status = 503;
    throw e;
  }
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw Error("DATABASE_URL должен быть строкой PostgreSQL");
  const pg = require("pg");
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(114, (v) => v);
  pg.types.setTypeParser(3802, (v) => v);
  for (const k of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    parsed.searchParams.delete(k);
  pool = new pg.Pool({
    connectionString: parsed.toString(),
    ssl:
      process.env.PG_SSL === "false" && process.env.NODE_ENV !== "production"
        ? false
        : {
            rejectUnauthorized: true,
            ...(process.env.PG_CA_CERT
              ? { ca: process.env.PG_CA_CERT.replace(/\\n/g, "\n") }
              : {}),
          },
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 15000,
    allowExitOnIdle: true,
  });
  pool.on("error", (e) =>
    console.error("Database connection error:", e.code || "connection"),
  );
  return pool;
}
async function query(q, params = []) {
  if (testing) {
    const stmt = sqlite.prepare(q);
    if (/^\s*(SELECT|WITH)\b/i.test(q)) return { rows: stmt.all(...params) };
    const result = stmt.run(...params);
    return { rows: [], rowCount: result.changes };
  }
  return (context.getStore() || getPool()).query(sql(q), params);
}
const get = async (q, ...a) => (await query(q, a)).rows[0];
const all = async (q, ...a) => (await query(q, a)).rows;
const run = async (q, ...a) => query(q, a);
async function transaction(f) {
  if (context.getStore()) return f();
  if (testing) {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const value = await f();
      sqlite.exec("COMMIT");
      return value;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='15s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('pit-v6-write'))",
    );
    const value = await context.run(client, f);
    await client.query("COMMIT");
    return value;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function close() {
  if (pool) await pool.end();
  if (sqlite) sqlite.close();
}
module.exports = { get, all, run, transaction, close, testing, sql };
