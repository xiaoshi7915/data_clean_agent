import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CleaningRule, InvalidAction, UnmatchedStrategy } from "@contracts/types";
import { fillStrategyLabels, variantLabels } from "./rulesShared";
import {
  INVALID_ACTION_RULE_TYPES,
  UNMATCHED_STRATEGY_RULE_TYPES,
} from "../../../api/services/cleaningActionRegistry";
import { pickRuleVariantDefaultKey } from "../../../api/services/analysisService";

const INVALID_ACTION_LABELS: Record<InvalidAction, string> = {
  reject: "删除行（reject）",
  keep: "保留原值",
  null: "置为 NULL",
  empty_string: "置为空字符串",
  custom: "自定义值",
  flag: "标记无效（flag）",
};

const UNMATCHED_STRATEGY_LABELS: Record<UnmatchedStrategy, string> = {
  keep: "保留原值",
  null: "置为 NULL",
  custom: "自定义值",
  reject: "删除行",
};

/** 校验规则 invalidAction 编辑器 */
export function InvalidActionParameterEditor({
  rule,
  onParameterChange,
}: {
  rule: CleaningRule;
  onParameterChange: (ruleId: string, params: Record<string, unknown>) => void;
}) {
  const ruleType = rule.parameters.type as string | undefined;
  if (!ruleType || !INVALID_ACTION_RULE_TYPES.has(ruleType)) return null;

  const invalidAction = (rule.parameters.invalidAction as InvalidAction) || "null";

  return (
    <div className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
      <Select
        value={invalidAction}
        onValueChange={(value: InvalidAction) =>
          onParameterChange(rule.id, { ...rule.parameters, invalidAction: value })
        }
      >
        <SelectTrigger size="sm" className="h-7 w-full max-w-[240px] text-xs">
          <SelectValue placeholder="无效值处理" />
        </SelectTrigger>
        <SelectContent position="popper" className="z-[110]">
          {(Object.keys(INVALID_ACTION_LABELS) as InvalidAction[]).map((key) => (
            <SelectItem key={key} value={key}>
              {INVALID_ACTION_LABELS[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {invalidAction === "custom" && (
        <Input
          className="h-7 text-xs max-w-[240px]"
          value={String(rule.parameters.customValue ?? "")}
          onChange={(e) =>
            onParameterChange(rule.id, {
              ...rule.parameters,
              invalidAction: "custom",
              customValue: e.target.value,
            })
          }
          placeholder="无效时的自定义值"
        />
      )}
    </div>
  );
}

/** 码表 dictMap 未匹配策略编辑器 */
export function UnmatchedStrategyEditor({
  rule,
  onParameterChange,
}: {
  rule: CleaningRule;
  onParameterChange: (ruleId: string, params: Record<string, unknown>) => void;
}) {
  const ruleType = rule.parameters.type as string | undefined;
  const fromCodeTable = rule.parameters.fromCodeTable === true;
  if (
    !fromCodeTable &&
    (!ruleType || !UNMATCHED_STRATEGY_RULE_TYPES.has(ruleType))
  ) {
    return null;
  }

  const strategy = (rule.parameters.unmatchedStrategy as UnmatchedStrategy) || "keep";

  return (
    <div className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
      <Select
        value={strategy}
        onValueChange={(value: UnmatchedStrategy) =>
          onParameterChange(rule.id, { ...rule.parameters, unmatchedStrategy: value })
        }
      >
        <SelectTrigger size="sm" className="h-7 w-full max-w-[240px] text-xs">
          <SelectValue placeholder="未匹配值处理" />
        </SelectTrigger>
        <SelectContent position="popper" className="z-[110]">
          {(Object.keys(UNMATCHED_STRATEGY_LABELS) as UnmatchedStrategy[]).map((key) => (
            <SelectItem key={key} value={key}>
              {UNMATCHED_STRATEGY_LABELS[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {strategy === "custom" && (
        <Input
          className="h-7 text-xs max-w-[240px]"
          value={String(rule.parameters.customUnmatchedValue ?? "")}
          onChange={(e) =>
            onParameterChange(rule.id, {
              ...rule.parameters,
              unmatchedStrategy: "custom",
              customUnmatchedValue: e.target.value,
            })
          }
          placeholder="未匹配时的自定义值"
        />
      )}
    </div>
  );
}

export type RuleVariantOption = {
  key: string;
  action: CleaningRule["action"];
  name: string;
  strategy: string;
  parameters: Record<string, unknown>;
  riskLevel?: "high" | "medium" | "low";
  riskNote?: string;
};

export function VariantSelector({
  rule,
  onParameterChange,
}: {
  rule: CleaningRule;
  onParameterChange: (ruleId: string, params: Record<string, unknown>) => void;
}) {
  const variants = rule.parameters.variants as RuleVariantOption[] | undefined;
  if (!variants || variants.length <= 1) return null;

  const selectedKey =
    (rule.parameters.selectedVariant as string) ||
    pickRuleVariantDefaultKey(
      variants,
      rule.parameters.issueCategory as string | undefined
    );

  const selectedVariant = variants.find((v) => v.key === selectedKey);
  const showFixedInput =
    selectedKey === "fixed" ||
    selectedVariant?.parameters?.strategy === "fixed" ||
    rule.parameters.strategy === "fixed";

  const handleSelect = (key: string) => {
    const selected = variants.find((v) => v.key === key);
    if (!selected) return;
    onParameterChange(rule.id, {
      ...rule.parameters,
      ...selected.parameters,
      issueCategory: rule.parameters.issueCategory,
      variants,
      selectedVariant: key,
    });
  };

  const handleFillValueChange = (value: string) => {
    onParameterChange(rule.id, {
      ...rule.parameters,
      ...selectedVariant?.parameters,
      fillValue: value,
      strategy: "fixed",
      issueCategory: rule.parameters.issueCategory,
      variants,
      selectedVariant: selectedKey,
    });
  };

  return (
    <div className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
      <Select value={selectedKey} onValueChange={handleSelect}>
        <SelectTrigger size="sm" className="h-7 w-full max-w-[280px] text-xs">
          <SelectValue placeholder="选择处理策略" />
        </SelectTrigger>
        <SelectContent position="popper" className="z-[110]">
          {variants.map((v) => (
            <SelectItem key={v.key} value={v.key}>
              {variantLabels[v.key] || v.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showFixedInput && (
        <Input
          className="h-7 text-xs max-w-[280px]"
          value={String(rule.parameters.fillValue ?? "")}
          onChange={(e) => handleFillValueChange(e.target.value)}
          placeholder="输入固定填充值（如 UNKNOWN 或 NOW()）"
        />
      )}
      {selectedVariant?.strategy && (
        <p className="text-[10px] text-muted-foreground line-clamp-2">
          {selectedVariant.strategy}
        </p>
      )}
    </div>
  );
}

export function FillNullParameterEditor({
  rule,
  onParameterChange,
}: {
  rule: CleaningRule;
  onParameterChange: (ruleId: string, params: Record<string, unknown>) => void;
}) {
  const strategy = (rule.parameters.strategy as string) || "fixed";

  const updateStrategy = (next: string) => {
    const params: Record<string, unknown> = { ...rule.parameters, strategy: next };
    if (next === "variable") {
      params.variableName = rule.field;
      params.fillValue = `\${${rule.field}}`;
    }
    if (next === "fixed" && params.fillValue === undefined) {
      params.fillValue = "UNKNOWN";
    }
    onParameterChange(rule.id, params);
  };

  return (
    <div className="mt-1.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <Select value={strategy} onValueChange={updateStrategy}>
        <SelectTrigger size="sm" className="h-7 w-full max-w-[200px] text-xs">
          <SelectValue placeholder="填充策略" />
        </SelectTrigger>
        <SelectContent position="popper" className="z-[110]">
          <SelectItem value="fixed">固定值</SelectItem>
          <SelectItem value="default">默认占位符</SelectItem>
          <SelectItem value="mean">列均值</SelectItem>
          <SelectItem value="variable">变量占位符</SelectItem>
        </SelectContent>
      </Select>
      {strategy === "fixed" && (
        <Input
          className="h-7 text-xs max-w-[200px]"
          value={String(rule.parameters.fillValue ?? "")}
          onChange={(e) =>
            onParameterChange(rule.id, {
              ...rule.parameters,
              strategy: "fixed",
              fillValue: e.target.value,
            })
          }
          placeholder="输入填充值"
        />
      )}
      {strategy === "variable" && (
        <Input
          className="h-7 text-xs max-w-[200px] font-mono"
          value={String(rule.parameters.variableName ?? rule.field)}
          onChange={(e) =>
            onParameterChange(rule.id, {
              ...rule.parameters,
              strategy: "variable",
              variableName: e.target.value,
              fillValue: `\${${e.target.value}}`,
            })
          }
          placeholder="变量名"
        />
      )}
      <p className="text-[10px] text-muted-foreground">
        策略：{fillStrategyLabels[strategy] || strategy}
        {strategy === "mean" && " · SQL 使用 AVG 窗口函数"}
        {strategy === "variable" && ` · 占位符 ${rule.parameters.fillValue ?? ""}`}
      </p>
    </div>
  );
}
