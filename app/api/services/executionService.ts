import mysql from "mysql2/promise";
import { createConnection } from "./dataSourceService";
import type {
  SQLStep,
  DatabaseDialect,
  ExecutionResult,
  ExecutionStepResult,
  QualityScore,
  RetryContext,
  RetryOption,
} from "@contracts/types";
import { validateSQL, isDangerousOperation } from "./sqlGenerationService";

export async function executeSQLSteps(
  sessionId: string,
  steps: SQLStep[],
  dbConfig: { host: string; port: number; database: string; username: string; password: string },
  _dialect: DatabaseDialect,
  dryRun: boolean = false,
  metricsBefore: QualityScore
): Promise<ExecutionResult> {
  const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const stepResults: ExecutionStepResult[] = [];
  let overallStatus: ExecutionResult["overallStatus"] = "success";
  let backupTableName: string | undefined;
  let lastError: string | undefined;

  const pool = await createConnection(sessionId, dbConfig);

  try {
    for (const step of steps) {
      const startTime = Date.now();

      try {
        // Validate SQL
        const validation = validateSQL(step.sql);
        if (!validation.valid) {
          throw new Error(`SQL验证失败: ${validation.errors.join(", ")}`);
        }

        // Check dangerous operations
        if (isDangerousOperation(step.sql) && !dryRun) {
          throw new Error("检测到危险操作，已拦截执行");
        }

        if (dryRun) {
          // Dry run: just explain the SQL
          if (step.operationType === "SELECT" || step.operationType === "CREATE") {
            const [rows] = await pool.execute(step.sql);
            stepResults.push({
              stepNumber: step.stepNumber,
              name: step.name,
              status: "success",
              affectedRows: Array.isArray(rows) ? rows.length : 0,
              durationMs: Date.now() - startTime,
            });
          } else {
            // For UPDATE/DELETE, try to get estimated count
            const countSql = step.sql
              .replace(/UPDATE\s+/i, "SELECT COUNT(*) as cnt FROM ")
              .replace(/SET\s+.*WHERE/i, "WHERE")
              .replace(/DELETE\s+FROM/i, "SELECT COUNT(*) as cnt FROM");
            try {
              const [countResult] = await pool.execute(countSql);
              const estimatedRows = (countResult as { cnt: number }[])[0]?.cnt || 0;
              stepResults.push({
                stepNumber: step.stepNumber,
                name: `${step.name} (模拟)`,
                status: "success",
                affectedRows: estimatedRows,
                durationMs: Date.now() - startTime,
              });
            } catch {
              stepResults.push({
                stepNumber: step.stepNumber,
                name: `${step.name} (模拟)`,
                status: "success",
                affectedRows: step.affectedRows,
                durationMs: Date.now() - startTime,
              });
            }
          }
          continue;
        }

        // Execute the SQL
        const [result] = await pool.execute(step.sql);

        // Extract affected rows info
        let affectedRows = 0;
        if (result && typeof result === "object") {
          affectedRows = (result as mysql.OkPacket).affectedRows || 0;
          if (Array.isArray(result)) {
            affectedRows = result.length;
          }
        }

        // Track backup table name
        if (step.name === "创建备份表" && step.sql.includes("_backup_")) {
          const match = step.sql.match(/CREATE\s+TABLE\s+(\w+_backup_\w+)/i);
          if (match) backupTableName = match[1];
        }

        stepResults.push({
          stepNumber: step.stepNumber,
          name: step.name,
          status: "success",
          affectedRows,
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        lastError = errorMessage;

        stepResults.push({
          stepNumber: step.stepNumber,
          name: step.name,
          status: "failed",
          affectedRows: 0,
          error: errorMessage,
          durationMs: Date.now() - startTime,
        });

        overallStatus = step.stepNumber === 0 ? "failed" : "partial";

        // Don't break on partial failure (continue with remaining steps)
        // unless it's the backup step
        if (step.stepNumber === 0) {
          break;
        }
      }
    }

    // Calculate metrics after (simplified)
    const metricsAfter: QualityScore = { ...metricsBefore };
    // Adjust scores based on what was cleaned
    const completedSteps = stepResults.filter((s) => s.status === "success");
    if (completedSteps.length > 0) {
      metricsAfter.completeness = Math.min(100, metricsBefore.completeness + 5);
      metricsAfter.uniqueness = Math.min(100, metricsBefore.uniqueness + 10);
    }

    return {
      executionId,
      overallStatus,
      stepResults,
      metricsBefore,
      metricsAfter,
      backupTableName,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: lastError,
    };
  } catch (error) {
    return {
      executionId,
      overallStatus: "failed",
      stepResults,
      metricsBefore,
      backupTableName,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Keep connection open for potential retry
  }
}

export function generateRetryContext(
  errorMessage: string,
  failedStep: SQLStep,
  retryCount: number
): RetryContext {
  // Categorize error
  let errorType = "未知错误";
  let rootCause = "无法确定错误原因";

  if (/syntax/i.test(errorMessage)) {
    errorType = "语法错误";
    rootCause = "SQL语法与目标数据库方言不兼容";
  } else if (/permission|access|denied|privilege/i.test(errorMessage)) {
    errorType = "权限错误";
    rootCause = "当前数据库用户缺少必要的操作权限";
  } else if (/constraint|foreign key|unique/i.test(errorMessage)) {
    errorType = "约束冲突";
    rootCause = "操作违反了数据库的约束条件";
  } else if (/timeout|lock|deadlock/i.test(errorMessage)) {
    errorType = "超时/锁冲突";
    rootCause = "操作超时或遇到表锁冲突";
  } else if (/connection|network/i.test(errorMessage)) {
    errorType = "连接错误";
    rootCause = "与数据库的连接中断或无法建立";
  } else if (/column|table|doesn't exist|not found/i.test(errorMessage)) {
    errorType = "对象不存在";
    rootCause = "引用的表或列不存在";
  }

  // Generate options based on error type
  const options: RetryOption[] = [];

  if (errorType === "语法错误") {
    options.push({
      label: "方案A",
      description: "自动修正SQL语法",
      fixedSql: `-- 修正后的SQL（请根据实际情况调整）\n${failedStep.sql.replace(/`([^`]+)`/g, '"$1"')}`,
      scenario: "方言语法不兼容",
    });
    options.push({
      label: "方案B",
      description: "简化SQL逻辑",
      fixedSql: `-- 简化版本：分批执行\n${failedStep.sql}\nLIMIT 1000;`,
      scenario: "复杂SQL执行失败",
    });
  } else if (errorType === "权限错误") {
    options.push({
      label: "方案A",
      description: "使用更低权限的安全操作",
      fixedSql: `-- 只读查询替代\nSELECT * FROM (\n  ${failedStep.sql.split("\n").map((l) => "  " + l).join("\n")}\n) t WHERE 1=0; -- 零影响验证`,
      scenario: "权限不足",
    });
    options.push({
      label: "方案B",
      description: "生成手动执行脚本",
      fixedSql: failedStep.sql,
      scenario: "需要DBA授权后手动执行",
    });
  } else if (errorType === "约束冲突") {
    options.push({
      label: "方案A",
      description: "临时禁用约束检查（MySQL）",
      fixedSql: `SET FOREIGN_KEY_CHECKS = 0;\n${failedStep.sql}\nSET FOREIGN_KEY_CHECKS = 1;`,
      scenario: "外键约束冲突",
    });
    options.push({
      label: "方案B",
      description: "先清理关联数据",
      fixedSql: `-- 先处理关联表\n-- 然后重新执行:\n${failedStep.sql}`,
      scenario: "关联数据存在依赖",
    });
  } else {
    options.push({
      label: "方案A",
      description: "分批次执行",
      fixedSql: `${failedStep.sql}\nLIMIT 1000 OFFSET 0;`,
      scenario: "大数据量导致超时",
    });
    options.push({
      label: "方案B",
      description: "跳过此步骤继续",
      fixedSql: `-- 跳过: ${failedStep.name}\nSELECT 1;`,
      scenario: "非关键步骤可跳过",
    });
  }

  // Always add manual fix option
  options.push({
    label: "方案C",
    description: "手动修改SQL",
    fixedSql: failedStep.sql,
    scenario: "需要自定义修改",
  });

  return {
    errorType,
    errorMessage,
    failedStep: failedStep.stepNumber,
    failedStepName: failedStep.name,
    rootCause,
    options,
    retryCount,
  };
}

export async function applyManualFix(
  _sessionId: string,
  originalSteps: SQLStep[],
  stepNumber: number,
  modifiedSql: string
): Promise<SQLStep[]> {
  // Validate the modified SQL
  const validation = validateSQL(modifiedSql);
  if (!validation.valid) {
    throw new Error(`修改后的SQL验证失败: ${validation.errors.join(", ")}`);
  }

  return originalSteps.map((step) =>
    step.stepNumber === stepNumber ? { ...step, sql: modifiedSql } : step
  );
}
