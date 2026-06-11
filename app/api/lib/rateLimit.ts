/** 简易内存速率限制（按 key，滑动窗口约 1 分钟） */
const buckets = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 60_000;

export class RateLimitError extends Error {
  constructor(message = "请求过于频繁，请稍后再试") {
    super(message);
    this.name = "RateLimitError";
  }
}

/** 检查并记录一次请求；超限则抛出 RateLimitError */
export function checkRateLimit(key: string, maxPerWindow = 30): void {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now >= entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  if (entry.count >= maxPerWindow) {
    throw new RateLimitError();
  }

  entry.count += 1;
}

/** 从 Request 提取限流标识：优先 Bearer 令牌前缀，否则客户端 IP */
export function rateLimitKeyFromRequest(req: Request, scope: string): string {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim().slice(0, 16) : "";
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const identity = token ? `token:${token}` : `ip:${ip}`;
  return `${scope}:${identity}`;
}

/** 测试用：清空计数 */
export function resetRateLimitsForTests(): void {
  buckets.clear();
}
