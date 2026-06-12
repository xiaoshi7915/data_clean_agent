/** 历史运行只读提示文案 */
export function historicalRunReadonlyMessage(viewingRunIndex: number, currentRunIndex: number): string {
  return `当前为第 ${viewingRunIndex} 次运行（历史快照，只读）。请切换到第 ${currentRunIndex} 次（当前）后再操作。`;
}

/** 历史 revision 只读提示文案 */
export function historicalRevisionReadonlyMessage(
  viewingRevisionIndex: number,
  latestRevisionIndex: number
): string {
  return `当前查看的是里程碑 v${viewingRevisionIndex}（历史快照，只读）。请返回最新版本 v${latestRevisionIndex} 后再编辑。`;
}

/** 是否正在查看非当前 run */
export function isHistoricalRunView(viewingRunIndex: number, currentRunIndex: number): boolean {
  return viewingRunIndex !== currentRunIndex;
}

/** 是否正在查看非最新 revision（同 run 内） */
export function isHistoricalRevisionView(
  viewingRevisionIndex: number | null,
  latestRevisionIndex: number
): boolean {
  if (latestRevisionIndex <= 0) return false;
  if (viewingRevisionIndex == null) return false;
  return viewingRevisionIndex !== latestRevisionIndex;
}

/** 写 mutation 时携带的 runIndex（历史视图时不发起写入） */
export function writeRunIndexForMutation(
  viewingRunIndex: number,
  currentRunIndex: number
): number | undefined {
  return isHistoricalRunView(viewingRunIndex, currentRunIndex) ? undefined : currentRunIndex;
}
