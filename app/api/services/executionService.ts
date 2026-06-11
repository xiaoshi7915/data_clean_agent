import type {
  SQLStep,
  DatabaseDialect,
  ExecutionResult,
  QualityScore,
  RetryContext,
  RetryOption,
} from "@contracts/types";
import { runSqlSteps } from "../../engine/execution/runSqlSteps";
import { isSqlDialectSupported, unsupportedDialectMessage } from "@contracts/dataSourceSupport";
import {
  createConnectionForDialect,
  createSqlExecutorFromPool,
} from "./dataSourceService";
import { validateSQL } from "./sqlGenerationService";

export async function executeSQLSteps(
  sessionId: string,
  steps: SQLStep[],
  dbConfig: { host: string; port: number; database: string; username: string; password: string },
  dialect: DatabaseDialect,
  dryRun: boolean = false,
  metricsBefore: QualityScore
): Promise<ExecutionResult> {
  if (!isSqlDialectSupported(dialect)) {
    throw new Error(unsupportedDialectMessage(dialect));
  }

  const poolEntry = await createConnectionForDialect(sessionId, dbConfig, dialect);

  try {
    return await runSqlSteps({
      sessionId,
      steps,
      executor: createSqlExecutorFromPool(poolEntry),
      dryRun,
      metricsBefore,
    });
  } catch (error) {
    return {
      executionId: `exec_${Date.now()}`,
      overallStatus: "failed",
      stepResults: [],
      metricsBefore,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
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
