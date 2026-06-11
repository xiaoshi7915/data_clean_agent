import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ListChecks, ArrowRight, FileCode2, Wand2, PenLine } from "lucide-react";
import type { CleaningRule } from "@contracts/types";
import { isCustomRule } from "./rulesShared";
import { RulesToolbar } from "./RulesToolbar";
import { RulesList } from "./RulesList";
import { CustomRulesSection, type CustomRuleInput } from "./CustomRulesSection";

export type { CustomRuleInput };

interface RulesPanelProps {
  rules: CleaningRule[];
  onRuleStatusChange: (ruleId: string, status: CleaningRule["status"]) => void;
  onParameterChange: (ruleId: string, params: Record<string, unknown>) => void;
  onGenerateSQL: () => void;
  onConfirmAll?: () => void;
  onAddCustomRule?: (input: CustomRuleInput) => void | Promise<void>;
  onDeleteCustomRule?: (ruleId: string) => void | Promise<void>;
  onExportYaml?: () => void | Promise<void>;
  onExportJson?: () => void | Promise<void>;
  onImportContract?: (
    source: string,
    format?: "yaml" | "json" | "auto"
  ) => void | Promise<boolean>;
  availableFields?: string[];
  isLoading: boolean;
  embedded?: boolean;
  hideFooter?: boolean;
}

/** 规则面板组合壳：工具栏 + 自动规则列表 + 自定义规则区 */
export function RulesPanel({
  rules,
  onRuleStatusChange,
  onParameterChange,
  onGenerateSQL,
  onConfirmAll,
  onAddCustomRule,
  onDeleteCustomRule,
  onExportYaml,
  onExportJson,
  onImportContract,
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
        <CustomRulesSection
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
        <RulesList
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
        <RulesList
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

  const contractToolbar = (
    <RulesToolbar
      rulesCount={rules.length}
      onExportYaml={onExportYaml}
      onExportJson={onExportJson}
      onImportContract={onImportContract}
      isLoading={isLoading}
    />
  );

  const statusBadges = (
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
  );

  if (embedded) {
    return (
      <div className="space-y-4 pb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-primary" />
            清洗规则确认
          </h3>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{confirmedCount} 已确认</span>
              <span>{pendingCount} 待确认</span>
              {skippedCount > 0 && <span>{skippedCount} 已跳过</span>}
            </div>
            {contractToolbar}
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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-primary" />
            清洗规则确认
          </CardTitle>
          <div className="flex items-center gap-3 flex-wrap">
            {statusBadges}
            {contractToolbar}
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
