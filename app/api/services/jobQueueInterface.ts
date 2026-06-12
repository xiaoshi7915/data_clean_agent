import type { BatchPipelineResult } from "./batchPipelineService";

/** 批量任务状态（内存队列 MVP；未来可换 Redis/BullMQ 实现） */
export type BatchJobStatus = "pending" | "running" | "completed" | "failed";

export interface BatchJobProgress {
  processed: number;
  total: number;
  currentTable?: string;
}

export interface BatchJobRecord {
  jobId: string;
  sessionId: string;
  status: BatchJobStatus;
  progress: BatchJobProgress;
  result?: BatchPipelineResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** 异步任务队列抽象（P2：Redis 实现延后，当前仅 InMemory） */
export interface JobQueue {
  enqueueBatch(sessionId: string, options?: { maxTables?: number; skipTables?: string[] }): string;
  getBatchJob(jobId: string): BatchJobRecord | null;
}

/**
 * Redis/BullMQ 队列占位实现。
 * 部署 Redis 后替换 InMemoryJobQueue 即可，无需改 batchRouter 契约。
 */
export class DeferredRedisJobQueue implements JobQueue {
  enqueueBatch(): string {
    throw new Error("Redis 任务队列尚未启用，请使用内存队列（默认）或配置 REDIS_URL 后接入 BullMQ");
  }

  getBatchJob(): BatchJobRecord | null {
    return null;
  }
}
