import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ListChecks,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Eraser,
  Paintbrush,
  Scissors,
  Replace,
  Sparkles,
  FileCode2,
  Plus,
  PenLine,
  Wand2,
} from "lucide-react";
import type { CleaningAction, CleaningRule, RuleQualityCategory } from "@contracts/types";

const RULE_CATEGORY_LABELS: Record<RuleQualityCategory, string> = {
  integrity: "完整性",
  accuracy: "准确性",
  consistency: "一致性",
  uniqueness: "唯一性",
  validity: "有效性",
  text: "文本",
  document: "文档",
  skeleton: "骨架",
  metrics: "质量指标",
};

function getRuleCategoryLabel(rule: CleaningRule): string | undefined {
  const cat = rule.parameters.ruleCategory as RuleQualityCategory | undefined;
  return cat ? RULE_CATEGORY_LABELS[cat] : undefined;
}

export interface CustomRuleInput {
  field: string;
  action: CleaningAction;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  riskLevel?: "high" | "medium" | "low";
}

interface RulesPanelProps {
  rules: CleaningRule[];
  onRuleStatusChange: (ruleId: string, status: CleaningRule["status"]) => void;
  onParameterChange: (ruleId: string, params: Record<string, unknown>) => void;
  onGenerateSQL: () => void;
  onConfirmAll?: () => void;
  onAddCustomRule?: (input: CustomRuleInput) => void | Promise<void>;
  onDeleteCustomRule?: (ruleId: string) => void | Promise<void>;
  availableFields?: string[];
  isLoading: boolean;
  embedded?: boolean;
  hideFooter?: boolean;
}

function isCustomRule(rule: CleaningRule): boolean {
  return rule.parameters?.isCustom === true;
}

function isAdvancedDisabledRule(rule: CleaningRule): boolean {
  const type = rule.parameters.type as string | undefined;
  if (type === "mice_impute") return true;
  if (rule.parameters.recommended === false && rule.parameters.ruleCategory === "skeleton") {
    return true;
  }
  return rule.parameters.enabled === false;
}

function getAdvancedRuleLabel(rule: CleaningRule): string {
  return String(rule.parameters.advancedLabel ?? "高级(未启用)");
}

const actionOptions: { value: CleaningAction; label: string }[] = [
  { value: "fill_null", label: "填充空值" },
  { value: "dedup", label: "去重" },
  { value: "format", label: "格式化" },
  { value: "truncate", label: "截断" },
  { value: "convert_type", label: "类型转换" },
  { value: "standardize", label: "标准化" },
  { value: "split", label: "拆分" },
  { value: "merge", label: "合并" },
  { value: "remove", label: "删除" },
];

function defaultParametersForAction(action: CleaningAction): Record<string, unknown> {
  switch (action) {
    case "fill_null":
      return { strategy: "fixed", fillValue: "UNKNOWN" };
    case "truncate":
      return { maxLength: 255 };
    case "format":
      return { pattern: "", replacement: "" };
    case "standardize":
      return { targetFormat: "lower" };
    case "split":
      return { delimiter: ",", targetColumn: "" };
    case "dedup":
      return { scope: "column" };
    case "convert_type":
      return { targetType: "VARCHAR(255)" };
    case "remove":
      return { condition: "IS NULL" };
    default:
      return {};
  }
}

const actionIcons: Record<string, React.ReactNode> = {
  dedup: <Eraser className="w-4 h-4" />,
  fill_null: <Paintbrush className="w-4 h-4" />,
  format: <Sparkles className="w-4 h-4" />,
  truncate: <Scissors className="w-4 h-4" />,
  convert_type: <Replace className="w-4 h-4" />,
  remove: <Trash2 className="w-4 h-4" />,
  standardize: <Sparkles className="w-4 h-4" />,
  split: <Scissors className="w-4 h-4" />,
  merge: <Replace className="w-4 h-4" />,
};

const actionLabels: Record<string, string> = {
  dedup: "去重",
  fill_null: "填充空值",
  format: "格式化",
  truncate: "截断",
  convert_type: "类型转换",
  remove: "删除",
  standardize: "标准化",
  split: "拆分",
  merge: "合并",
};

const fillStrategyLabels: Record<string, string> = {
  fixed: "固定值",
  default: "默认占位",
  mean: "列均值",
  variable: "变量占位",
};

const variantLabels: Record<string, string> = {
  fixed: "固定值填充",
  default: "默认占位符",
  mean: "列均值填充",
  variable: "变量占位符",
  remove: "删除空值行",
  null_literal: "填充 NULL",
  ffill: "前向填充",
  bfill: "后向填充",
  keep_first: "保留首条",
  keep_last: "保留最新",
  iqr: "IQR 异常值",
  zscore: "Z-score 3σ",
  winsorize: "Winsorize 截断",
  code_value: "码表文本值",
  code_number: "码表数字编码",
  lower: "统一小写",
};

type RuleVariantOption = {
  key: string;
  action: CleaningRule["action"];
  name: string;
  strategy: string;
  parameters: Record<string, unknown>;
  riskLevel?: "high" | "medium" | "low";
  riskNote?: string;
};

function VariantSelector({
  rule,
  onParameterChange,
}: {
  rule: CleaningRule;
  onParameterChange: (ruleId: string, params: Record<string, unknown>) => void;
}) {
  const variants = rule.parameters.variants as RuleVariantOption[] | undefined;
  if (!variants || variants.length <= 1) return null;

  const selectedKey =
    (rule.parameters.selectedVariant as string) || variants[0].key;

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

function CustomRuleForm({
  availableFields,
  onAdd,
  isLoading,
}: {
  availableFields: string[];
  onAdd: (input: CustomRuleInput) => void | Promise<void>;
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState("");
  const [customField, setCustomField] = useState("");
  const [action, setAction] = useState<CleaningAction>("fill_null");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [paramsJson, setParamsJson] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const resolvedField = field === "__custom__" ? customField.trim() : field;

  const handleActionChange = (next: CleaningAction) => {
    setAction(next);
    setParamsJson(JSON.stringify(defaultParametersForAction(next), null, 2));
  };

  const handleOpen = () => {
    setOpen(true);
    if (!paramsJson) {
      setParamsJson(JSON.stringify(defaultParametersForAction(action), null, 2));
    }
  };

  const handleSubmit = async () => {
    if (!resolvedField || !name.trim()) return;
    let parameters: Record<string, unknown> = defaultParametersForAction(action);
    if (paramsJson.trim()) {
      try {
        parameters = JSON.parse(paramsJson) as Record<string, unknown>;
      } catch {
        return;
      }
    }
    setSubmitting(true);
    try {
      await onAdd({
        field: resolvedField,
        action,
        name: name.trim(),
        description: description.trim() || undefined,
        parameters,
        riskLevel: "medium",
      });
      setField("");
      setCustomField("");
      setName("");
      setDescription("");
      setParamsJson(JSON.stringify(defaultParametersForAction(action), null, 2));
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 h-8 text-xs border-dashed"
        onClick={handleOpen}
        disabled={isLoading}
      >
        <Plus className="w-3.5 h-3.5" />
        添加自定义规则
      </Button>
    );
  }

  return (
    <Card className="border-sky-200/60 bg-sky-50/40 dark:bg-sky-950/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <PenLine className="w-4 h-4 text-sky-600" />
          <h4 className="text-sm font-semibold">新建自定义规则</h4>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">目标字段</Label>
            {availableFields.length > 0 ? (
              <Select value={field} onValueChange={setField}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="选择字段" />
                </SelectTrigger>
                <SelectContent position="popper" className="z-[110]">
                  {availableFields.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">手动输入...</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input
                className="h-8 text-xs"
                value={customField}
                onChange={(e) => setCustomField(e.target.value)}
                placeholder="字段名"
              />
            )}
            {field === "__custom__" && (
              <Input
                className="h-8 text-xs"
                value={customField}
                onChange={(e) => setCustomField(e.target.value)}
                placeholder="输入字段名"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">操作类型</Label>
            <Select value={action} onValueChange={(v) => handleActionChange(v as CleaningAction)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="z-[110]">
                {actionOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">规则名称</Label>
            <Input
              className="h-8 text-xs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：手机号格式标准化"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">规则描述</Label>
            <Textarea
              className="min-h-14 text-xs"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="说明此规则的处理逻辑与业务背景"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">参数（JSON）</Label>
            <Textarea
              className="min-h-20 text-xs font-mono"
              value={paramsJson}
              onChange={(e) => setParamsJson(e.target.value)}
              placeholder='{"strategy":"fixed","fillValue":"UNKNOWN"}'
            />
          </div>
        </div>
        <div className="flex items-center gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={handleSubmit}
            disabled={submitting || isLoading || !resolvedField || !name.trim()}
          >
            <Plus className="w-3.5 h-3.5" />
            {submitting ? "添加中..." : "添加规则"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FillNullParameterEditor({
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

function RulesTable({
  rules,
  onRuleStatusChange,
  onParameterChange,
  onDeleteCustomRule,
  emptyMessage,
}: {
  rules: CleaningRule[];
  onRuleStatusChange: (ruleId: string, status: CleaningRule["status"]) => void;
  onParameterChange: (ruleId: string, params: Record<string, unknown>) => void;
  onDeleteCustomRule?: (ruleId: string) => void | Promise<void>;
  emptyMessage: string;
}) {
  return (
    <div className="overflow-x-auto w-full">
      <Table className="min-w-[720px] text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">确认</TableHead>
            <TableHead>规则</TableHead>
            <TableHead>操作</TableHead>
            <TableHead>目标字段</TableHead>
            <TableHead>影响行数</TableHead>
            <TableHead>风险等级</TableHead>
            <TableHead className="w-8">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            rules.map((rule) => {
              const custom = isCustomRule(rule);
              return (
                <TableRow
                  key={rule.id}
                  className={
                    rule.status === "skipped"
                      ? "opacity-50"
                      : rule.status === "confirmed"
                      ? "bg-emerald-500/5"
                      : custom
                      ? "bg-sky-500/5"
                      : ""
                  }
                >
                  <TableCell>
                    <Switch
                      checked={rule.status === "confirmed"}
                      onCheckedChange={(checked) =>
                        onRuleStatusChange(rule.id, checked ? "confirmed" : "pending")
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-muted-foreground">{rule.id}</span>
                        <span className="text-sm font-medium">{rule.name}</span>
                        {getRuleCategoryLabel(rule) && (
                          <Badge variant="outline" className="text-[10px]">
                            {getRuleCategoryLabel(rule)}
                          </Badge>
                        )}
                        {custom && (
                          <Badge variant="secondary" className="text-[10px] bg-sky-100 text-sky-800">
                            自定义
                          </Badge>
                        )}
                        {isAdvancedDisabledRule(rule) && (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-amber-700 border-amber-300"
                          >
                            {getAdvancedRuleLabel(rule)}
                          </Badge>
                        )}
                      </div>
                      <VariantSelector rule={rule} onParameterChange={onParameterChange} />
                      {!rule.parameters.variants && rule.strategy && (
                        <p className="text-[10px] text-muted-foreground line-clamp-2">{rule.strategy}</p>
                      )}
                      {rule.action === "fill_null" &&
                        !(Array.isArray(rule.parameters.variants) && rule.parameters.variants.length > 1) && (
                          <FillNullParameterEditor rule={rule} onParameterChange={onParameterChange} />
                        )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">
                        {actionIcons[rule.action] || <Sparkles className="w-4 h-4" />}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {actionLabels[rule.action] || rule.action}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{rule.field}</TableCell>
                  <TableCell className="text-xs">
                    {rule.affectedRows.toLocaleString()}
                    <span className="text-muted-foreground ml-1">({rule.affectedPercent}%)</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {rule.riskLevel === "high" ? (
                        <ShieldAlert className="w-3.5 h-3.5 text-destructive" />
                      ) : rule.riskLevel === "medium" ? (
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                      ) : (
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                      )}
                      <Badge
                        variant={
                          rule.riskLevel === "high"
                            ? "destructive"
                            : rule.riskLevel === "medium"
                            ? "default"
                            : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {rule.riskLevel === "high" ? "高" : rule.riskLevel === "medium" ? "中" : "低"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    {custom && onDeleteCustomRule ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        title="删除自定义规则"
                        onClick={() => onDeleteCustomRule(rule.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive/70" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        title="跳过规则"
                        onClick={() =>
                          onRuleStatusChange(rule.id, rule.status === "skipped" ? "pending" : "skipped")
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function RulesPanel({
  rules,
  onRuleStatusChange,
  onParameterChange,
  onGenerateSQL,
  onConfirmAll,
  onAddCustomRule,
  onDeleteCustomRule,
  availableFields = [],
  isLoading,
  embedded,
  hideFooter,
}: RulesPanelProps) {
  const confirmedCount = rules.filter((r) => r.status === "confirmed").length;
  const skippedCount = rules.filter((r) => r.status === "skipped").length;
  const pendingCount = rules.filter((r) => r.status === "pending").length;
  const autoRules = rules.filter((r) => !isCustomRule(r));
  const customRules = rules.filter((r) => isCustomRule(r));

  const tableContent = (
    <div className="space-y-5">
      {onAddCustomRule && (
        <CustomRuleForm
          availableFields={availableFields}
          onAdd={onAddCustomRule}
          isLoading={isLoading}
        />
      )}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-semibold">自动生成的规则</h4>
          <Badge variant="outline" className="text-[10px]">
            {autoRules.length} 条
          </Badge>
        </div>
        <RulesTable
          rules={autoRules}
          onRuleStatusChange={onRuleStatusChange}
          onParameterChange={onParameterChange}
          emptyMessage="暂无自动规则。完成质量分析后将在此展示，您也可手动添加自定义规则。"
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <PenLine className="w-4 h-4 text-sky-600" />
          <h4 className="text-sm font-semibold">自定义规则</h4>
          <Badge variant="outline" className="text-[10px] border-sky-200 text-sky-700">
            {customRules.length} 条
          </Badge>
        </div>
        <RulesTable
          rules={customRules}
          onRuleStatusChange={onRuleStatusChange}
          onParameterChange={onParameterChange}
          onDeleteCustomRule={onDeleteCustomRule}
          emptyMessage="暂无自定义规则。点击上方「添加自定义规则」创建。"
        />
      </div>
    </div>
  );

  const footer = !hideFooter && (
    <>
      <Separator className="my-4" />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          已确认 <span className="font-semibold text-foreground">{confirmedCount}</span> /{" "}
          {rules.length} 条规则
          {skippedCount > 0 && <span>，跳过 {skippedCount} 条</span>}
        </div>
        <div className="flex items-center gap-2">
          {onConfirmAll && pendingCount > 0 && (
            <Button variant="outline" onClick={onConfirmAll} disabled={isLoading} className="gap-2">
              <ListChecks className="w-4 h-4" />
              确认全部
            </Button>
          )}
          <Button
            onClick={onGenerateSQL}
            disabled={isLoading || confirmedCount === 0}
            className="gap-2"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                生成中...
              </span>
            ) : (
              <>
                <FileCode2 className="w-4 h-4" />
                生成清洗SQL
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="space-y-4 pb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-primary" />
            清洗规则确认
          </h3>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{confirmedCount} 已确认</span>
            <span>{pendingCount} 待确认</span>
            {skippedCount > 0 && <span>{skippedCount} 已跳过</span>}
          </div>
        </div>
        {tableContent}
        {footer}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-primary" />
            清洗规则确认
          </CardTitle>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs text-muted-foreground">{confirmedCount} 已确认</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-xs text-muted-foreground">{pendingCount} 待确认</span>
            </div>
            {skippedCount > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                <span className="text-xs text-muted-foreground">{skippedCount} 已跳过</span>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-80">{tableContent}</ScrollArea>
        {footer}
      </CardContent>
    </Card>
  );
}
