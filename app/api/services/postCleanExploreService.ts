import type { QualityScore } from "@contracts/types";
import { generateQualityReport } from "./analysisService";
import { exploreDatabase } from "./dataSourceService";
import { resolveDbConfigInput } from "./sessionCredentialService";
import { getSession } from "./sessionService";
import { cleanedTableName } from "./sqlGenerationService";
import type { DatabaseDialect } from "@contracts/types";

export interface PostCleanExploreOptions {
  /** 清洗输出表名，默认 `{sourceTable}_cleaned` */
  cleanedTable?: string;
  sampleLimit?: number;
}

/**
 * 清洗执行成功后对输出表/文件结果重新探查，写入 phase=after 质量报告。
 * 失败时返回 null，调用方应保留估算 metrics 作为兜底。
 */
export async function runPostCleanExplore(
  sessionId: string,
  _metricsBefore: QualityScore,
  options: PostCleanExploreOptions = {}
): Promise<QualityScore | null> {
  const session = await getSession(sessionId);
  if (!session?.dataSource?.dbConfig || !session.targetTable) {
    return null;
  }

  const dialect = session.dataSource.type as DatabaseDialect;
  if (!["mysql", "postgresql", "sqlite", "sqlserver", "oracle"].includes(dialect)) {
    return null;
  }

  const cleanedTable =
    options.cleanedTable ?? cleanedTableName(session.targetTable);
  const limit = options.sampleLimit ?? 100;

  try {
    const dbConfig = await resolveDbConfigInput(sessionId, session.dataSource.dbConfig);
    const exploration = await exploreDatabase(
      sessionId,
      dbConfig,
      cleanedTable,
      limit,
      dialect
    );
    const report = generateQualityReport(exploration);
    return report.score;
  } catch {
    return null;
  }
}
