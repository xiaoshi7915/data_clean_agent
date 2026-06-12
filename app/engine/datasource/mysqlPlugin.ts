import type { DBConnectionConfig } from "@contracts/types";
import {
  exploreDatabase,
  listMysqlTables,
  testMysqlConnection,
} from "../../api/services/dataSourceService";
import type { DataSourcePlugin, ExploreOptions } from "./plugin";
import { registerDataSourcePlugin } from "./plugin";

/** MySQL 数据源插件：包装现有 dataSourceService 路径 */
export const mysqlDataSourcePlugin: DataSourcePlugin = {
  type: "mysql",
  supportedActions: [
    "fill_null",
    "dedup",
    "format",
    "truncate",
    "convert_type",
    "standardize",
    "split",
    "merge",
    "remove",
  ],

  async testConnection(config: DBConnectionConfig): Promise<void> {
    await testMysqlConnection(config);
  },

  async listTables(config: DBConnectionConfig) {
    return listMysqlTables(config);
  },

  async explore(config: DBConnectionConfig, options: ExploreOptions) {
    if (!options.tableName) {
      throw new Error("MySQL 探查需要 tableName");
    }
    return exploreDatabase(
      options.sessionId ?? "cli",
      config,
      options.tableName,
      options.limit ?? 100,
      "mysql",
      {
        exactRowCount: options.exactRowCount,
        onProgress: options.onProgress,
      }
    );
  },
};

registerDataSourcePlugin(mysqlDataSourcePlugin);
