import type { DatabaseDialect, ExplorationResult } from "@contracts/types";
import type { CleaningSessionState } from "./cleaningSessionState";
import { isDbSourceType } from "./cleaningSessionState";

export function resolveDialect(dataSourceType: string): DatabaseDialect {
  if (dataSourceType === "postgresql") return "postgresql";
  if (dataSourceType === "sqlite") return "sqlite";
  if (dataSourceType === "sqlserver") return "sqlserver";
  if (dataSourceType === "oracle") return "oracle";
  return "mysql";
}

export function toExploreDbType(type: string): DatabaseDialect | undefined {
  if (type === "mysql" || type === "postgresql" || type === "sqlite" || type === "sqlserver" || type === "oracle") {
    return type;
  }
  return undefined;
}

type ExploreMutations = Pick<
  CleaningSessionState["mutations"],
  "exploreDb" | "exploreFile"
>;

/** 探查数据库或文件，返回结果与解析后的表名 */
export async function runExploration(
  sessionId: string,
  dataSource: NonNullable<CleaningSessionState["dataSource"]>,
  tableName: string | undefined,
  mutations: ExploreMutations
): Promise<{ exploration: ExplorationResult; resolvedTable: string }> {
  const isDbSource = isDbSourceType(dataSource.type);
  let resolvedTable = tableName?.trim() || "";

  if (isDbSource) {
    if (!dataSource.dbConfig) {
      throw new Error("缺少数据库连接信息，请返回重新连接数据源");
    }
    if (!resolvedTable) {
      throw new Error("请先选择要探查的数据表");
    }
    const exploreResult = await mutations.exploreDb.mutateAsync({
      sessionId,
      config: dataSource.dbConfig,
      tableName: resolvedTable,
      limit: 100,
      dbType: toExploreDbType(dataSource.type),
    });
    if (!exploreResult.success || !exploreResult.result) {
      throw new Error(exploreResult.error || "探查失败");
    }
    return { exploration: exploreResult.result, resolvedTable };
  }

  if (dataSource.fileConfig) {
    const exploreResult = await mutations.exploreFile.mutateAsync({
      sessionId,
      filePath: dataSource.fileConfig.filePath,
      fileType: dataSource.fileConfig.fileType,
      previewRows: 100,
    });
    if (!exploreResult.success || !exploreResult.result) {
      throw new Error(exploreResult.error || "探查失败");
    }
    resolvedTable =
      dataSource.fileConfig.fileName.replace(/\.[^.]+$/, "") || exploreResult.result.sourceName;
    return { exploration: exploreResult.result, resolvedTable };
  }

  throw new Error("无效的数据源配置");
}

export function cleanedOutputHint(
  dataSource: CleaningSessionState["dataSource"],
  targetTable?: string
): string {
  if (dataSource?.fileConfig) {
    return dataSource.fileConfig.fileName.replace(/(\.[^.]+)$/, "_cleaned$1");
  }
  return targetTable ? `${targetTable}_cleaned` : "_cleaned 表";
}

export function exploreCompleteMessage(exploration: ExplorationResult): string {
  return `📊 数据探查完成！\n\n**${exploration.sourceName}**\n- 总行数：${exploration.totalRows.toLocaleString()} 行\n- 总列数：${exploration.totalCols} 列\n- 发现 ${exploration.issues.length} 个潜在问题`;
}
