/**
 * 安全执行 008_pipeline_run_index.sql：流水线 run_index 版本化。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

function parseDatabaseUrl(url) {
  const m = url.match(/^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/);
  if (!m) throw new Error(`无法解析 DATABASE_URL: ${url}`);
  return {
    user: decodeURIComponent(m[1]),
    password: decodeURIComponent(m[2]),
    host: m[3],
    port: Number(m[4]),
    database: m[5],
  };
}

async function columnExists(conn, database, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [database, table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function tableExists(conn, database, table) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [database, table]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL 未设置");

  const cfg = parseDatabaseUrl(databaseUrl);
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true });

  const hasRunIndex =
    (await columnExists(conn, cfg.database, "cleaning_sessions", "current_run_index")) &&
    (await tableExists(conn, cfg.database, "pipeline_runs"));

  if (hasRunIndex) {
    console.log("Migration 008 already applied, skipping.");
    await conn.end();
    return;
  }

  const sqlPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "db",
    "migrations",
    "008_pipeline_run_index.sql"
  );
  const raw = readFileSync(sqlPath, "utf8");
  const sql = raw.replace(/ADD COLUMN IF NOT EXISTS/g, "ADD COLUMN");

  console.log("Running migration: 008_pipeline_run_index.sql");
  await conn.query(sql);
  await conn.end();
  console.log("Migration 008 completed successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
