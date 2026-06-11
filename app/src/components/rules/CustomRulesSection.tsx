import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, PenLine } from "lucide-react";
import type { CleaningAction } from "@contracts/types";
import { actionOptions, defaultParametersForAction } from "./rulesShared";

export interface CustomRuleInput {
  field: string;
  action: CleaningAction;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  riskLevel?: "high" | "medium" | "low";
}

export function CustomRulesSection({
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
