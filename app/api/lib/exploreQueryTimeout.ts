import { env } from "./env";

/** 探查 SQL 执行超时（用户可见错误） */
export class ExploreQueryTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(
      `探查查询超时（${Math.round(timeoutMs / 1000)} 秒）。表可能过大，请使用抽样探查或联系 DBA 优化索引。`
    );
    this.name = "ExploreQueryTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** 读取探查查询超时毫秒数（默认 60s，可通过 EXPLORE_QUERY_TIMEOUT_MS 配置） */
export function getExploreQueryTimeoutMs(): number {
  const raw = env.exploreQueryTimeoutMs;
  if (!Number.isFinite(raw) || raw <= 0) return 60_000;
  return Math.min(Math.floor(raw), 600_000);
}

/** 判断是否为探查查询超时类错误（含驱动/数据库原生超时文案） */
export function isExploreQueryTimeoutError(error: unknown): boolean {
  if (error instanceof ExploreQueryTimeoutError) return true;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("max_execution_time") ||
    lower.includes("statement timeout") ||
    lower.includes("query execution was interrupted") ||
    lower.includes("ora-01013") ||
    lower.includes("timeout") ||
    lower.includes("timed out")
  );
}

/** 将底层数据库错误映射为用户可读的探查失败说明 */
export function mapExploreQueryError(error: unknown): Error {
  if (error instanceof ExploreQueryTimeoutError) return error;
  if (isExploreQueryTimeoutError(error)) {
    return new ExploreQueryTimeoutError(getExploreQueryTimeoutMs());
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** 用 Promise.race 为任意探查查询施加超时 */
export async function withExploreQueryTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = getExploreQueryTimeoutMs()
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ExploreQueryTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
