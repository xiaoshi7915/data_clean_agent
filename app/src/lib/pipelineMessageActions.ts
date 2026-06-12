import type { ChatMessageAction } from "@contracts/types";

/** 探查/分析完成后常用的「查看报告」类快捷按钮 */
export const VIEW_PIPELINE_REPORT_ACTIONS: ChatMessageAction[] = [
  { id: "view-explore", label: "查看探查报告", type: "viewExplore" },
  { id: "view-quality", label: "查看质量报告", type: "viewQuality" },
  { id: "view-rules", label: "查看清洗规则", type: "viewRules" },
];

/** 一键生成 SQL 完成后的快捷按钮（含查看 SQL） */
export const VIEW_PIPELINE_WITH_SQL_ACTIONS: ChatMessageAction[] = [
  ...VIEW_PIPELINE_REPORT_ACTIONS,
  { id: "view-sql", label: "查看清洗SQL", type: "viewSQL" },
];
