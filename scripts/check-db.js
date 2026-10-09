"use strict";
const { URL } = require("node:url");

const TABLES = [
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
];

function hint(e) {
  const code = e.code || e.name;
  const map = {
    ECONNREFUSED: "Хост или порт закрыты. Для Transaction pooler порт 6543.",
    ETIMEDOUT: "Нет ответа от пулера. Проверьте хост из окна Connect и сетевой доступ.",
    ENOTFOUND: "Хост не найден. Скопируйте host из Supabase → Connection string, не вводите вручную.",
    EAI_AGAIN: "DNS не разрешился. Проверьте подключение к интернету.",
    "28P01": "Пароль базы неверный. Это пароль из Supabase → Settings → Database, не от аккаунта.",
    "28000": "Аутентификация не пройдена. Проверьте пользователя и пароль.",
    "3D000": "База postgres не найдена. В строке должно быть /postgres в конце.",
    "42501": "Нет прав. Нужна роль postgres.",
    "42P01": "Схема pit не найдена. SQL из папки supabase ещё не выполнен.",
    "3F000": "Схема pit не найдена. Выполните supabase/001_pit.sql в Supabase → SQL Editor.",
    SELF_SIGNED_CERT_IN_CHAIN: "TLS: сертификат не прошёл проверку. Нужен PG_CA_CERT, а не отключение проверки.",
    DEPTH_ZERO_SELF_SIGNED_CERT: "TLS: самоподписанный сертификат. Нужен PG_CA_CERT из настроек Supabase.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS: цепочка сертификатов неполная. Нужен PG_CA_CERT.",
    CERT_HAS_EXPIRED: "TLS: сертификат истёк.",
  };
  return map[code] || map[String(code).slice(0, 5)] || "См. текст ошибки выше.";
}

function redact(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "(не удалось разобрать URL)";
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в окружении.");
    console.error(
      "Передайте строку подключения переменной окружения этого терминала, например через .env.local или --env-file.",
    );
    process.exit(2);
  }
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    console.error("DATABASE_URL должен начинаться с postgresql:// — сейчас:", parsed.protocol);
    process.exit(2);
  }
  if (
    !parsed.password ||
    /^\[?YOUR[-_]?PASSWORD\]?$/i.test(decodeURIComponent(parsed.password)) ||
    /^%5B/i.test(parsed.password)
  ) {
    console.error("В DATABASE_URL вместо пароля заглушка [YOUR-PASSWORD].");
    console.error(
      "Сбросьте пароль базы: Supabase → Project Settings → Database → Reset database password.",
    );
    process.exit(2);
  }
  console.log("Подключение к:", redact(url));
  const pg = require("pg");
  const client = new pg.Client({
    connectionString: url,
    ssl: process.env.PG_CA_CERT
      ? { rejectUnauthorized: true, ca: process.env.PG_CA_CERT.replace(/\\n/g, "\n") }
      : { rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
  });
  try {
    await client.connect();
    console.log("OK  соединение установлено, TLS проверен");
  } catch (e) {
    console.error("FAIL соединение:", e.message);
    console.error("Код:", e.code || e.name);
    console.error(hint(e));
    process.exit(1);
  }
  try {
    const v = await client.query("SELECT version() AS v");
    console.log("OK  PostgreSQL", v.rows[0].v.split(" ").slice(0, 2).join(" "));
    const role = await client.query("SELECT current_user AS u, current_database() AS d");
    console.log("OK  роль", role.rows[0].u, "база", role.rows[0].d);
    const port = parsed.port || "5432";
    const pooler = /pooler\.supabase\.com/.test(parsed.hostname);
    console.log(
      pooler && port === "6543"
        ? "OK  Transaction pooler, порт 6543"
        : pooler
          ? "WARN pooler, но порт " + port + " (для Transaction pooler ожидается 6543)"
          : "WARN не pooler-адрес: " + parsed.hostname,
    );
    const found = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='pit'",
    );
    const have = new Set(found.rows.map((r) => r.table_name));
    const missing = TABLES.filter((t) => !have.has(t));
    if (!have.size) {
      console.error("FAIL схема pit пуста. Выполните SQL из папки supabase в порядке 001, 002, 003.");
      process.exit(1);
    }
    if (missing.length) {
      console.error("FAIL нет таблиц:", missing.join(", "));
      console.error("Догрузите недостающие файлы из папки supabase.");
      process.exit(1);
    }
    console.log("OK  все", TABLES.length, "таблиц схемы pit на месте");
    const t = await client.query("SELECT count(*)::int AS n FROM pit.tenants");
    console.log(
      t.rows[0].n
        ? "OK  tenants: " + t.rows[0].n + " — владелец уже создан, OWNER_PASSWORD больше не нужен"
        : "OK  tenants пуст — при первом запросе создастся СТО и владелец из OWNER_EMAIL/OWNER_PASSWORD",
    );
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('pit-v6-write')) AS ok");
    console.log(lock.rows[0].ok ? "OK  advisory lock доступен" : "WARN advisory lock занят другим соединением");
    console.log("\nСоединение готово для Vercel. Скопируйте ту же строку в DATABASE_URL.");
  } catch (e) {
    console.error("FAIL проверка:", e.message);
    console.error("Код:", e.code || e.name);
    console.error(hint(e));
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();