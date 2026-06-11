import { TRPCError } from "@trpc/server";

const BEARER_PREFIX = "Bearer ";

/** 从请求头提取 Bearer Token */
export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token || null;
}

/** 校验 API 访问令牌（使用 APP_SECRET；开发环境未配置时跳过） */
export function verifyApiToken(req: Request): boolean {
  const secret = process.env.APP_SECRET ?? "";
  const isProduction = process.env.NODE_ENV === "production";
  if (!secret) {
    return !isProduction;
  }
  const token = extractBearerToken(req);
  return token === secret;
}

/** tRPC 中间件用：未授权则抛出 UNAUTHORIZED */
export function assertAuthenticated(req: Request): void {
  if (verifyApiToken(req)) return;
  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "缺少或无效的 Authorization Bearer 令牌",
  });
}
