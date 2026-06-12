import { exploreDatabase, exploreFile } from "../services/dataSourceService";
import type { ExploreProgressStep } from "../services/exploreProgressService";
import type { AgentInput, AgentOutput, SchemaAgentOutput } from "./types";
import type { DBConnectionConfig, DataSourceConfig } from "@contracts/types";

/** Schema 探查 Agent：封装 dataSourceService 探查能力 */
export async function runSchemaAgent(
  input: AgentInput & {
    dataSource: DataSourceConfig;
    dbConfig?: DBConnectionConfig;
    tableName: string;
    limit?: number;
    exactRowCount?: boolean;
    onProgress?: (
      step: ExploreProgressStep,
      message: string,
      meta?: { columnIndex?: number; columnTotal?: number }
    ) => void;
  }
): Promise<AgentOutput<SchemaAgentOutput>> {
  try {
    const { sessionId, dataSource, tableName, limit = 100, exactRowCount, onProgress } = input;

    if (dataSource.fileConfig) {
      const exploration = await exploreFile(
        dataSource.fileConfig.filePath,
        dataSource.fileConfig.fileType,
        limit
      );
      return { success: true, data: { exploration } };
    }

    if (!dataSource.dbConfig) {
      return { success: false, error: "缺少数据库连接配置" };
    }

    const exploration = await exploreDatabase(
      sessionId,
      dataSource.dbConfig,
      tableName,
      limit,
      dataSource.type,
      { exactRowCount, onProgress }
    );
    return { success: true, data: { exploration } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
