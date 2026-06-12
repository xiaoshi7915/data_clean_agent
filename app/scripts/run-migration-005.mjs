/**
 * 安全执行 005_quality_report_phase.sql：为 quality_reports 增加 phase 列。
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
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true });

  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'quality_reports' AND COLUMN_NAME = 'phase'`,
    [cfg.database]
  );

  if (Array.isArray(cols) && cols.length > 0) {
    console.log("Column quality_reports.phase already exists, skipping.");
    await conn.end();
    return;
  }

  const sqlPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "db",
    "migrations",
    "005_quality_report_phase.sql"
  );
  const raw = readFileSync(sqlPath, "utf8");
  const sql = raw.replace("ADD COLUMN IF NOT EXISTS", "ADD COLUMN");

  console.log("Running migration: 005_quality_report_phase.sql");
  await conn.query(sql);
  await conn.end();
  console.log("Migration 005 completed successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
