import "dotenv/config";
import path from "path";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

/** 是否允许对生产库执行真实写操作（默认 false，即 SCRIPT_ONLY） */
const allowExecute = process.env.ALLOW_EXECUTE === "true";

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  uploadDir: process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"),
  llmBaseUrl: process.env.LLM_BASE_URL ?? "",
  llmApiKey: process.env.LLM_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "MiniMax-M2.7",
  /** 显式允许真实执行（开发/运维需设置 ALLOW_EXECUTE=true） */
  allowExecute,
  /** 脚本-only 模式：默认 true，禁止写生产库，仅导出 SQL + Soda 校验脚本 */
  scriptOnly: !allowExecute,
};
