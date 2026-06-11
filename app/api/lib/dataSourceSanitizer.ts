import type { DataSourceConfig, DBConnectionConfig } from "@contracts/types";

/** 返回给客户端的脱敏密码占位符 */
export const MASKED_PASSWORD = "********";

/** 判断密码是否未提供（空或脱敏占位） */
export function isPasswordMissing(password: string | null | undefined): boolean {
  return !password || password === MASKED_PASSWORD;
}

/** 脱敏数据源配置，避免明文密码下发到浏览器 */
export function sanitizeDataSourceForClient(
  config: DataSourceConfig | null | undefined
): DataSourceConfig | undefined {
  if (!config) return undefined;
  if (!config.dbConfig) return config;
  return {
    ...config,
    dbConfig: sanitizeDbConfigForClient(config.dbConfig),
  };
}

/** 脱敏数据库连接配置中的密码字段 */
export function sanitizeDbConfigForClient(config: DBConnectionConfig): DBConnectionConfig {
  return {
    ...config,
    password: MASKED_PASSWORD,
  };
}
