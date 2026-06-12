/** 会话数据范围：单表 / 单文件 / 整库（与服务端校验共用） */
export type SessionScope = "table" | "file" | "whole_db";

export interface SessionScopeRow {
  targetTable?: string | null;
  filePath?: string | null;
  fileName?: string | null;
  sessionScope?: SessionScope | null;
}

export function resolveSessionScope(row: SessionScopeRow): SessionScope | null {
  if (row.sessionScope) return row.sessionScope;
  if (row.filePath || row.fileName) return "file";
  if (row.targetTable === "__whole_db__") return "whole_db";
  if (row.targetTable) return "table";
  return null;
}

export function assertCanBindTargetTable(
  row: SessionScopeRow,
  targetTable: string
): void {
  const scope = resolveSessionScope(row);
  if (scope === "file") {
    throw new Error("文件会话不可绑定数据表，请新建会话");
  }
  if (scope === "whole_db") {
    throw new Error("整库会话不可绑定单表，请新建会话");
  }
  if (scope === "table" && row.targetTable && row.targetTable !== targetTable) {
    throw new Error("当前会话已绑定数据表，请新建会话后再选择其他表");
  }
}
