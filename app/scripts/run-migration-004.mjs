/**
 * 安全执行 004_orchestration_runs.sql：仅 CREATE TABLE IF NOT EXISTS，不 truncate。
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

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL 未设置");

  const cfg = parseDatabaseUrl(databaseUrl);
  const conn = await mysql.createConnection({
    ...cfg,
    multipleStatements: true,
  });

  const sqlPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "db",
    "migrations",
    "004_orchestration_runs.sql"
  );
  const sql = readFileSync(sqlPath, "utf8");

  console.log("Running migration: 004_orchestration_runs.sql");
  await conn.query(sql);

  const [rows] = await conn.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orchestration_runs'`,
    [cfg.database]
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("验证失败：orchestration_runs 表不存在");
  }

  console.log("Verified table: orchestration_runs");
  await conn.end();
  console.log("Migration 004 completed successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
