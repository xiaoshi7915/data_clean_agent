import type {
  DBConnectionConfig,
  ExplorationResult,
  DatabaseTableInfo,
  CleaningAction,
} from "@contracts/types";

import type { ExploreProgressStep } from "../../api/services/exploreProgressService";

/** 数据源插件探查参数 */
export interface ExploreOptions {
  /** 会话 ID，供连接池复用（CLI 可用固定值如 cli） */
  sessionId?: string;
  tableName?: string;
  limit?: number;
  filePath?: string;
  fileType?: string;
  /** 大表是否强制执行精确 COUNT(*)（默认 false，使用 catalog 估算） */
  exactRowCount?: boolean;
  /** 探查阶段进度回调 */
  onProgress?: (
    step: ExploreProgressStep,
    message: string,
    meta?: { columnIndex?: number; columnTotal?: number }
  ) => void;
}

/** 数据源插件执行参数 */
export interface ExecuteOptions {
  sql: string;
  dryRun?: boolean;
}

/** 数据源插件契约：统一 explore / execute 入口 */
export interface DataSourcePlugin {
  /** 数据源类型标识，如 mysql */
  readonly type: string;
  /** 该插件支持的清洗动作子集 */
  readonly supportedActions: CleaningAction[];
  /** 测试连接 */
  testConnection(config: DBConnectionConfig): Promise<void>;
  /** 列出库表（数据库类数据源） */
  listTables?(config: DBConnectionConfig): Promise<DatabaseTableInfo[]>;
  /** 探查表或文件 */
  explore(config: DBConnectionConfig, options: ExploreOptions): Promise<ExplorationResult>;
  /** 执行 SQL（可选，文件源可不实现） */
  execute?(config: DBConnectionConfig, options: ExecuteOptions): Promise<unknown>;
}

/** 插件注册表 */
const plugins = new Map<string, DataSourcePlugin>();

export function registerDataSourcePlugin(plugin: DataSourcePlugin): void {
  plugins.set(plugin.type, plugin);
}

export function getDataSourcePlugin(type: string): DataSourcePlugin | undefined {
  return plugins.get(type);
}

export function listDataSourcePlugins(): DataSourcePlugin[] {
  return [...plugins.values()];
}
