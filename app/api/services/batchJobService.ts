import { v4 as uuidv4 } from "uuid";
import {
  runBatchPipelineForDatabase,
  type BatchPipelineResult,
} from "./batchPipelineService";
import type { BatchJobRecord, JobQueue } from "./jobQueueInterface";

const jobs = new Map<string, BatchJobRecord>();

function touchJob(job: BatchJobRecord, patch: Partial<BatchJobRecord>): void {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

async function processBatchJob(
  jobId: string,
  sessionId: string,
  options?: { maxTables?: number; skipTables?: string[] }
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  touchJob(job, { status: "running" });

  try {
    const onTableStart = (tableName: string, index: number, total: number) => {
      touchJob(job, {
        progress: { processed: index, total, currentTable: tableName },
      });
    };

    const result = await runBatchPipelineForDatabase(sessionId, {
      ...options,
      onTableStart,
    });

    touchJob(job, {
      status: "completed",
      progress: { processed: result.processed, total: result.processed },
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    touchJob(job, { status: "failed", error: message });
  }
}

/** 内存批量任务队列（无 Redis 依赖） */
export class InMemoryJobQueue implements JobQueue {
  enqueueBatch(
    sessionId: string,
    options?: { maxTables?: number; skipTables?: string[] }
  ): string {
    const jobId = uuidv4();
    const now = Date.now();
    const total = options?.maxTables ?? 10;
    jobs.set(jobId, {
      jobId,
      sessionId,
      status: "pending",
      progress: { processed: 0, total },
      createdAt: now,
      updatedAt: now,
    });

    void processBatchJob(jobId, sessionId, options);
    return jobId;
  }

  getBatchJob(jobId: string): BatchJobRecord | null {
    return jobs.get(jobId) ?? null;
  }
}

/** 进程内单例队列（生产可换 Redis 实现） */
export const batchJobQueue: JobQueue = new InMemoryJobQueue();

/** 测试用：清空内存任务 */
export function _resetBatchJobsForTest(): void {
  jobs.clear();
}

export type { BatchPipelineResult };
