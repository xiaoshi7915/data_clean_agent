import type { ChatMessage, ChatMessageAction } from "@contracts/types";

/** 打开面板查看某次 run 产物时，需先切换到对应 runIndex */
export const VIEW_PANEL_ACTION_TYPES = new Set<ChatMessageAction["type"]>([
  "viewExplore",
  "viewQuality",
  "viewRules",
  "viewSQL",
  "updateRule",
  "skipRule",
  "confirmRule",
]);

/** 需按 revision 快照查看规则/SQL 的按钮 */
export const REVISION_VIEW_ACTION_TYPES = new Set<ChatMessageAction["type"]>([
  "viewRules",
  "viewSQL",
]);

/** 从消息 metadata 或 DB 列解析所属 runIndex */
export function getMessageRunIndex(message: ChatMessage): number {
  const fromMeta = message.metadata?.runIndex;
  if (typeof fromMeta === "number" && fromMeta > 0) return fromMeta;
  return 1;
}

/** 从消息 metadata 解析里程碑 revisionIndex */
export function getMessageRevisionIndex(message: ChatMessage): number | undefined {
  const fromMeta = message.metadata?.revisionIndex;
  if (typeof fromMeta === "number" && fromMeta > 0) return fromMeta;
  return undefined;
}

/** 为快捷按钮绑定所属 runIndex 与可选 revisionIndex */
export function bindActionsToRun(
  actions: ChatMessageAction[],
  runIndex: number,
  revisionIndex?: number
): ChatMessageAction[] {
  return actions.map((action) => ({
    ...action,
    runIndex,
    ...(revisionIndex != null && revisionIndex > 0 ? { revisionIndex } : {}),
  }));
}

/** 解析按钮应使用的 runIndex（按钮自身优先，否则回落到消息） */
export function resolveActionRunIndex(
  action: ChatMessageAction,
  message?: ChatMessage
): number | undefined {
  if (action.runIndex != null && action.runIndex > 0) return action.runIndex;
  if (message) return getMessageRunIndex(message);
  return undefined;
}

/** 解析按钮应使用的 revisionIndex（按钮自身优先，否则回落到消息） */
export function resolveActionRevisionIndex(
  action: ChatMessageAction,
  message?: ChatMessage
): number | undefined {
  if (action.revisionIndex != null && action.revisionIndex > 0) return action.revisionIndex;
  if (message) return getMessageRevisionIndex(message);
  return undefined;
}

/**
 * 若查看类按钮来自历史 run，返回应切换到的 runIndex；否则 null。
 */
export function targetRunIndexForViewAction(
  action: ChatMessageAction,
  viewingRunIndex: number,
  message?: ChatMessage
): number | null {
  if (!VIEW_PANEL_ACTION_TYPES.has(action.type)) return null;
  const target = resolveActionRunIndex(action, message);
  if (target == null || target === viewingRunIndex) return null;
  return target;
}

/**
 * 若查看规则/SQL 按钮绑定了历史 revision，返回应切换到的 revisionIndex；否则 null。
 */
export function targetRevisionIndexForViewAction(
  action: ChatMessageAction,
  viewingRevisionIndex: number | null,
  latestRevisionIndex: number,
  message?: ChatMessage
): number | null {
  if (!REVISION_VIEW_ACTION_TYPES.has(action.type)) return null;
  const target = resolveActionRevisionIndex(action, message);
  if (target == null) return null;

  const effectiveViewing = viewingRevisionIndex ?? latestRevisionIndex;
  if (target === effectiveViewing) return null;
  return target;
}

/** 消息 actions 是否需创建规则/SQL 里程碑快照 */
export function actionsNeedPipelineSnapshot(actions?: ChatMessageAction[]): boolean {
  if (!actions?.length) return false;
  return actions.some((a) => REVISION_VIEW_ACTION_TYPES.has(a.type));
}
