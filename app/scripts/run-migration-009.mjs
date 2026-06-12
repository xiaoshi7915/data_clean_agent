/**
 * 安全执行 009_pipeline_snapshots.sql：同 run 内规则/SQL 里程碑快照。
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

  if (await tableExists(conn, cfg.database, "pipeline_snapshots")) {
    console.log("Migration 009 already applied, skipping.");
    await conn.end();
    return;
  }

  const sqlPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "db",
    "migrations",
    "009_pipeline_snapshots.sql"
  );
  const raw = readFileSync(sqlPath, "utf8");

  console.log("Running migration: 009_pipeline_snapshots.sql");
  await conn.query(raw);
  await conn.end();
  console.log("Migration 009 completed successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
