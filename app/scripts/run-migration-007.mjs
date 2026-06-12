/**
 * 安全执行 007_saved_data_sources_soft_delete.sql：为 saved_data_sources 增加 deleted_at。
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
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'saved_data_sources' AND COLUMN_NAME = 'deleted_at'`,
    [cfg.database]
  );

  if (Array.isArray(cols) && cols.length > 0) {
    console.log("Column saved_data_sources.deleted_at already exists, skipping.");
    await conn.end();
    return;
  }

  const sqlPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "db",
    "migrations",
    "007_saved_data_sources_soft_delete.sql"
  );
  const raw = readFileSync(sqlPath, "utf8");
  const sql = raw
    .replace(/ADD COLUMN IF NOT EXISTS/g, "ADD COLUMN")
    .replace(/CREATE INDEX IF NOT EXISTS/g, "CREATE INDEX");

  console.log("Running migration: 007_saved_data_sources_soft_delete.sql");
  await conn.query(sql);
  await conn.end();
  console.log("Migration 007 completed successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
