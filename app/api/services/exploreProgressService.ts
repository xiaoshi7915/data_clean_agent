/** 探查阶段标识（SSE / 前端进度展示） */
export type ExploreProgressStep =
  | "idle"
  | "connecting"
  | "loading_schema"
  | "counting_rows"
  | "column_stats"
  | "sampling"
  | "done"
  | "error";

export interface ExploreProgressEvent {
  sessionId: string;
  step: ExploreProgressStep;
  message: string;
  /** 列统计进度：当前列序号（1-based） */
  columnIndex?: number;
  /** 列统计进度：总列数 */
  columnTotal?: number;
  updatedAt: number;
}

type ProgressListener = (event: ExploreProgressEvent) => void;

const progressStore = new Map<string, ExploreProgressEvent>();
const listeners = new Map<string, Set<ProgressListener>>();

function emit(sessionId: string, event: ExploreProgressEvent): void {
  progressStore.set(sessionId, event);
  const subs = listeners.get(sessionId);
  if (subs) {
    for (const fn of subs) fn(event);
  }
}

/** 初始化探查进度（新探查开始前调用） */
export function resetExploreProgress(sessionId: string): void {
  emit(sessionId, {
    sessionId,
    step: "connecting",
    message: "正在连接数据库…",
    updatedAt: Date.now(),
  });
}

/** 更新探查进度 */
export function setExploreProgress(
  sessionId: string,
  step: ExploreProgressStep,
  message: string,
  meta?: Pick<ExploreProgressEvent, "columnIndex" | "columnTotal">
): void {
  emit(sessionId, {
    sessionId,
    step,
    message,
    columnIndex: meta?.columnIndex,
    columnTotal: meta?.columnTotal,
    updatedAt: Date.now(),
  });
}

/** 标记探查完成 */
export function completeExploreProgress(sessionId: string): void {
  setExploreProgress(sessionId, "done", "探查完成");
}

/** 标记探查失败 */
export function failExploreProgress(sessionId: string, message: string): void {
  emit(sessionId, {
    sessionId,
    step: "error",
    message,
    updatedAt: Date.now(),
  });
}

/** 读取当前进度快照 */
export function getExploreProgress(sessionId: string): ExploreProgressEvent | null {
  return progressStore.get(sessionId) ?? null;
}

/** 订阅进度变更（SSE 端点使用） */
export function subscribeExploreProgress(
  sessionId: string,
  listener: ProgressListener
): () => void {
  let subs = listeners.get(sessionId);
  if (!subs) {
    subs = new Set();
    listeners.set(sessionId, subs);
  }
  subs.add(listener);
  return () => {
    subs?.delete(listener);
    if (subs?.size === 0) listeners.delete(sessionId);
  };
}

/** 探查选项中的进度回调工厂 */
export function createExploreProgressReporter(sessionId: string) {
  return (
    step: ExploreProgressStep,
    message: string,
    meta?: Pick<ExploreProgressEvent, "columnIndex" | "columnTotal">
  ) => setExploreProgress(sessionId, step, message, meta);
}
