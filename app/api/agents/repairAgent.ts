import { generateCleaningSQL } from "../services/sqlGenerationService";
import type { AgentInput, AgentOutput, RepairAgentOutput } from "./types";
import type { CleaningRule, DatabaseDialect } from "@contracts/types";

/** 修复/SQL 生成 Agent：根据已确认规则生成清洗 SQL */
export function runRepairAgent(
  input: AgentInput & {
    rules: CleaningRule[];
    dialect: DatabaseDialect;
    tableName: string;
    databaseName: string;
    columns?: string[];
    sourceWhereClause?: string;
    explorationSampleBased?: boolean;
    explorationRowCountApproximate?: boolean;
    explorationSampleSize?: number;
  }
): AgentOutput<RepairAgentOutput> {
  try {
    const confirmed = input.rules.filter((r) => r.status === "confirmed");
    const sqlResult = generateCleaningSQL(
      confirmed.length > 0 ? input.rules : input.rules,
      input.dialect,
      input.tableName,
      input.databaseName,
      input.columns ?? [],
      {
        sourceWhereClause: input.sourceWhereClause,
        emitProblemTable: true,
        explorationSampleBased: input.explorationSampleBased,
        explorationRowCountApproximate: input.explorationRowCountApproximate,
        explorationSampleSize: input.explorationSampleSize,
      }
    );
    return { success: true, data: { sqlResult } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
