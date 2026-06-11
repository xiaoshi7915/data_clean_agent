import { getFullSession } from "./sessionService";
import type { CleaningPhase } from "@contracts/types";
import { isDatabaseSourceType, isDbExploreSupported, unsupportedDbMessage } from "@contracts/dataSourceSupport";

export type PhaseAction = "explore" | "analyze" | "confirm" | "generate" | "execute";

export class PhaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhaseValidationError";
  }
}

/**
 * 在执行阶段变更类 mutation 前校验前置条件
 */
export async function validatePhaseTransition(sessionId: string, targetAction: PhaseAction) {
  const session = await getFullSession(sessionId);
  if (!session) {
    throw new PhaseValidationError("会话不存在，请重新创建对话");
  }

  switch (targetAction) {
    case "explore": {
      if (!session.dataSource) {
        throw new PhaseValidationError("请先连接数据源后再探查");
      }
      if (
        isDatabaseSourceType(session.dataSource.type) &&
        !isDbExploreSupported(session.dataSource.type)
      ) {
        throw new PhaseValidationError(unsupportedDbMessage(session.dataSource.type));
      }
      if (isDatabaseSourceType(session.dataSource.type) && !session.targetTable && !session.dataSource.dbConfig) {
        throw new PhaseValidationError("数据库探查需要有效的连接配置");
      }
      if (session.dataSource.fileConfig && !session.dataSource.fileConfig.filePath) {
        throw new PhaseValidationError("文件探查需要已上传的文件路径");
      }
      break;
    }
    case "analyze": {
      if (!session.explorationResult) {
        throw new PhaseValidationError("请先完成数据探查，再进行质量分析");
      }
      break;
    }
    case "confirm": {
      const rules = session.cleaningRules ?? [];
      if (!session.qualityReport && rules.length === 0) {
        throw new PhaseValidationError("请先完成质量分析并生成清洗规则");
      }
      break;
    }
    case "generate": {
      const rules = session.cleaningRules ?? [];
      const confirmed = rules.filter((r) => r.status === "confirmed");
      if (confirmed.length === 0) {
        throw new PhaseValidationError("请至少确认一条清洗规则后再生成 SQL");
      }
      break;
    }
    case "execute": {
      if (!session.generatedSQL?.steps?.length) {
        throw new PhaseValidationError("请先生成清洗 SQL 后再执行");
      }
      if (
        session.dataSource &&
        isDatabaseSourceType(session.dataSource.type) &&
        !isDbExploreSupported(session.dataSource.type)
      ) {
        throw new PhaseValidationError(unsupportedDbMessage(session.dataSource.type));
      }
      break;
    }
  }

  return session;
}

export function phaseForAction(action: PhaseAction): CleaningPhase {
  switch (action) {
    case "explore":
      return "explore";
    case "analyze":
      return "analyze";
    case "confirm":
      return "confirm";
    case "generate":
      return "generate";
    case "execute":
      return "execute";
    default:
      return "idle";
  }
}
