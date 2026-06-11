import type { DatabaseDialect, SQLStep } from "@contracts/types";
import { validateSQL } from "../services/sqlGenerationService";
import {
  createConnectionForDialect,
  closeConnection,
  createSqlExecutorFromPool,
} from "../services/dataSourceService";
import type { DBConnectionConfig } from "@contracts/types";
import type { AgentOutput, VerifyAgentOutput } from "./types";

/** 对单条 SQL 执行 EXPLAIN 语法校验（MySQL / PostgreSQL） */
async function explainCheckSql(
  sql: string,
  dialect: DatabaseDialect,
  dbConfig: DBConnectionConfig,
  sessionId: string
): Promise<{ valid: boolean; errors: string[] }> {
  const staticCheck = validateSQL(sql);
  if (!staticCheck.valid) {
    return { valid: false, errors: staticCheck.errors };
  }

  if (dialect !== "mysql" && dialect !== "postgresql") {
    return { valid: true, errors: [] };
  }

  const poolEntry = await createConnectionForDialect(sessionId, dbConfig, dialect);
  try {
    const executor = createSqlExecutorFromPool(poolEntry);
    const explainSql =
      dialect === "postgresql" ? `EXPLAIN ${sql.replace(/;\s*$/, "")}` : `EXPLAIN ${sql}`;

    await executor.execute(explainSql);
    return { valid: true, errors: [] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { valid: false, errors: [`EXPLAIN 失败: ${msg}`] };
  } finally {
    await closeConnection(sessionId);
  }
}

/** SQL 校验 Agent：静态规则 + EXPLAIN 语法检查 */
export async function runVerifyAgent(input: {
  sessionId: string;
  steps: SQLStep[];
  dialect: DatabaseDialect;
  dbConfig?: DBConnectionConfig;
}): Promise<AgentOutput<VerifyAgentOutput>> {
  try {
    const stepResults: VerifyAgentOutput["stepResults"] = [];

    for (const step of input.steps) {
      const staticResult = validateSQL(step.sql);
      let valid = staticResult.valid;
      let errors = [...staticResult.errors];

      if (valid && input.dbConfig && (input.dialect === "mysql" || input.dialect === "postgresql")) {
        const explainResult = await explainCheckSql(
          step.sql,
          input.dialect,
          input.dbConfig,
          `${input.sessionId}_verify_${step.stepNumber}`
        );
        valid = explainResult.valid;
        errors = errors.concat(explainResult.errors);
      }

      stepResults.push({ stepNumber: step.stepNumber, valid, errors });
    }

    const allValid = stepResults.every((s) => s.valid);
    return {
      success: true,
      data: { valid: allValid, stepResults },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 增强版 validateSQL：供 API 与 CLI 复用 */
export function enhancedValidateSQL(sql: string): { valid: boolean; errors: string[] } {
  const result = validateSQL(sql);
  const errors = [...result.errors];

  if (!sql.trim()) {
    errors.push("SQL 不能为空");
  }

  if (/;\s*;\s*/.test(sql)) {
    errors.push("检测到连续分号，可能存在语法问题");
  }

  return { valid: errors.length === 0, errors };
}
