import type { DataSourceConfig } from "@contracts/types";

/** 会话数据范围：单表 / 单文件 / 整库 */
export type SessionScope = "table" | "file" | "whole_db";

export interface SessionScopeInput {
  targetTable?: string | null;
  filePath?: string | null;
  fileName?: string | null;
  sessionScope?: SessionScope | null;
}

/** 根据会话字段推断当前范围 */
export function resolveSessionScope(input: SessionScopeInput): SessionScope | null {
  if (input.sessionScope) return input.sessionScope;
  if (input.filePath || input.fileName) return "file";
  if (input.targetTable === "__whole_db__") return "whole_db";
  if (input.targetTable) return "table";
  return null;
}

/** 文件数据源无需选表 */
export function isFileDataSource(config: DataSourceConfig | null | undefined): boolean {
  return !!config?.fileConfig;
}

/** 会话是否已锁定单一探查目标（不可在同会话内更换表/文件） */
export function isSessionScopeLocked(input: SessionScopeInput): boolean {
  return resolveSessionScope(input) !== null;
}

/** 尝试绑定新表名时是否需要新建会话 */
export function needsNewSessionForTable(
  currentTargetTable: string | undefined | null,
  nextTable: string,
  scope: SessionScope | null
): boolean {
  if (scope === "file" || scope === "whole_db") return true;
  if (scope === "table" && currentTargetTable && currentTargetTable !== nextTable) {
    return true;
  }
  return false;
}
