import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Eraser,
  Paintbrush,
  Scissors,
  Replace,
  Sparkles,
} from "lucide-react";
import type { CleaningRule } from "@contracts/types";
import {
  actionLabels,
  getRuleCategoryLabel,
  isAdvancedDisabledRule,
  isCustomRule,
  getAdvancedRuleLabel,
} from "./rulesShared";
import { VariantSelector, FillNullParameterEditor } from "./RuleEditForm";

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

export function RulesList({
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
