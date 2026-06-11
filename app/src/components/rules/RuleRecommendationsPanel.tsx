import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Plus } from "lucide-react";
import type { CleaningRule } from "@contracts/types";

interface RuleRecommendationsPanelProps {
  rules: CleaningRule[];
  onAddRule: (ruleId: string) => void;
}

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

export function RuleRecommendationsPanel({ rules, onAddRule }: RuleRecommendationsPanelProps) {
  const recommended = rules.filter((r) => {
    if (r.status !== "pending") return false;
    const variants = r.parameters?.variants as
      | Array<{ parameters?: Record<string, unknown> }>
      | undefined;
    if (variants && variants.length > 0) {
      return variants.some((v) => v.parameters?.recommended === true);
    }
    return r.parameters?.recommended === true;
  });

  if (recommended.length === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">AI 智能推荐规则</h3>
        <Badge variant="secondary" className="text-[10px]">
          {recommended.length} 条
        </Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {recommended.map((rule) => (
          <Card key={rule.id} className="border-primary/20 bg-primary/5">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{rule.name}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {rule.strategy || rule.issueDescription}
                  </p>
                  {rule.action === "fill_null" && rule.parameters?.strategy != null ? (
                    <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                      填充策略：
                      {String(rule.parameters.strategy) === "fixed"
                        ? `固定值 ${String(rule.parameters.fillValue ?? "")}`
                        : String(rule.parameters.strategy) === "mean"
                        ? "列均值"
                        : String(rule.parameters.strategy) === "variable"
                        ? `变量 ${String(rule.parameters.fillValue ?? "")}`
                        : "默认占位符"}
                    </p>
                  ) : null}
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {actionLabels[rule.action] || rule.action}
                </Badge>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground font-mono">{rule.field}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  onClick={() => onAddRule(rule.id)}
                >
                  <Plus className="w-3 h-3" />
                  添加此规则
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
