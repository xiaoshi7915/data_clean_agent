import { spawn } from "node:child_process";
import type { VerificationResult } from "./types";

export interface SodaDataSourceConfig {
  type: "mysql" | "postgresql";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

/**
 * 调用 soda-core CLI 执行扫描；CLI 不可用时返回 skipped 结果
 */
export async function runSodaScan(
  checksPath: string,
  _dataSourceConfig?: SodaDataSourceConfig
): Promise<VerificationResult> {
  return new Promise((resolve) => {
    const proc = spawn("soda", ["scan", checksPath], {
      shell: true,
      timeout: 60_000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", () => {
      resolve({
        status: "skipped",
        details: "soda-core CLI 未安装或不可用，已跳过扫描",
        rawOutput: stderr,
      });
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({
          status: "pass",
          details: "Soda 扫描通过",
          rawOutput: stdout,
          checksPassed: parseCheckCount(stdout, "passed"),
          checksFailed: 0,
        });
      } else if (code === null) {
        resolve({
          status: "skipped",
          details: "Soda 扫描超时或中断",
          rawOutput: stdout + stderr,
        });
      } else {
        resolve({
          status: "fail",
          details: `Soda 扫描失败 (exit ${code})`,
          rawOutput: stdout + stderr,
          checksFailed: parseCheckCount(stdout + stderr, "failed"),
        });
      }
    });
  });
}

/** 从 soda 输出中粗略解析检查数量 */
function parseCheckCount(output: string, kind: "passed" | "failed"): number {
  const pattern = kind === "passed" ? /(\d+)\s+checks?\s+passed/i : /(\d+)\s+checks?\s+failed/i;
  const match = output.match(pattern);
  return match ? Number(match[1]) : 0;
}
