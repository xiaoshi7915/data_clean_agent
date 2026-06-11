import type { DBConnectionConfig } from "@contracts/types";
import { isPasswordMissing } from "../lib/dataSourceSanitizer";
import { resolveDbConfigForSession } from "./sessionService";

/**
 * 合并客户端传入的连接参数与服务端凭证：
 * 当 password 为空或脱敏占位时，从 sessionId 对应数据源读取真实密码。
 */
export async function resolveDbConfigInput(
  sessionId: string | undefined,
  config: DBConnectionConfig | undefined
): Promise<DBConnectionConfig> {
  if (config && !isPasswordMissing(config.password)) {
    return config;
  }

  if (!sessionId) {
    throw new Error("缺少数据库连接凭证，请重新配置数据源");
  }

  const resolved = await resolveDbConfigForSession(sessionId);
  if (!resolved) {
    throw new Error("无法从会话解析数据库凭证，请检查数据源配置");
  }

  if (!config) {
    return resolved;
  }

  return {
    ...resolved,
    ...config,
    password: resolved.password,
  };
}
