import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload, FileJson, FileType, Download } from "lucide-react";
import { CONTRACT_TEMPLATE_YAML } from "@contracts/contractTemplate";

function downloadContractTemplate(filename = "cleaning-contract-template.yaml"): void {
  const blob = new Blob([CONTRACT_TEMPLATE_YAML], { type: "text/yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ContractImportDialog({
  open,
  onOpenChange,
  onImport,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (source: string, format: "yaml" | "json" | "auto") => void | Promise<boolean>;
  isLoading: boolean;
}) {
  const [source, setSource] = useState("");
  const [format, setFormat] = useState<"yaml" | "json" | "auto">("auto");
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setSource("");
    setFormat("auto");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setSource(text);
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".json")) setFormat("json");
      else if (lower.endsWith(".yaml") || lower.endsWith(".yml")) setFormat("yaml");
      else setFormat("auto");
    } catch {
      toast.error("读取文件失败");
    }
    e.target.value = "";
  };

  const handleSubmit = async () => {
    if (!source.trim()) {
      toast.error("请粘贴契约内容或上传文件");
      return;
    }
    setSubmitting(true);
    try {
      const ok = await onImport(source, format);
      if (ok) {
        reset();
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4" />
            导入清洗契约
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept=".yaml,.yml,.json,application/json,text/yaml"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || submitting}
            >
              <Upload className="w-3.5 h-3.5" />
              选择文件
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-xs"
              onClick={() => downloadContractTemplate()}
              disabled={isLoading || submitting}
            >
              <Download className="w-3.5 h-3.5" />
              下载模版
            </Button>
            <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
              <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="z-[120]">
                <SelectItem value="auto">自动识别</SelectItem>
                <SelectItem value="yaml">YAML</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Textarea
            className="min-h-[240px] text-xs font-mono"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="粘贴 YAML 或 JSON 契约内容，或通过上方按钮上传 .yaml / .json 文件"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button size="sm" className="gap-1.5" onClick={handleSubmit} disabled={submitting || isLoading}>
            {submitting ? "导入中..." : "确认导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RulesToolbar({
  rulesCount,
  onExportYaml,
  onExportJson,
  onImportContract,
  isLoading,
}: {
  rulesCount: number;
  onExportYaml?: () => void | Promise<void>;
  onExportJson?: () => void | Promise<void>;
  onImportContract?: (
    source: string,
    format?: "yaml" | "json" | "auto"
  ) => void | Promise<boolean>;
  isLoading: boolean;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const hasContractActions = onExportYaml || onExportJson || onImportContract;

  if (!hasContractActions) return null;

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {onExportYaml && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 text-xs"
            disabled={isLoading || rulesCount === 0}
            onClick={() => void onExportYaml()}
            title={rulesCount === 0 ? "暂无规则可导出" : "导出 YAML 契约"}
          >
            <FileType className="w-3.5 h-3.5" />
            导出 YAML
          </Button>
        )}
        {onExportJson && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 text-xs"
            disabled={isLoading || rulesCount === 0}
            onClick={() => void onExportJson()}
            title={rulesCount === 0 ? "暂无规则可导出" : "导出 JSON 契约"}
          >
            <FileJson className="w-3.5 h-3.5" />
            导出 JSON
          </Button>
        )}
        {onImportContract && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-xs"
              disabled={isLoading}
              onClick={() => downloadContractTemplate()}
              title="下载可导入的 YAML 契约模版"
            >
              <Download className="w-3.5 h-3.5" />
              下载模版
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-xs border-dashed"
              disabled={isLoading}
              onClick={() => setImportOpen(true)}
            >
              <Upload className="w-3.5 h-3.5" />
              导入契约
            </Button>
          </>
        )}
      </div>
      {onImportContract && (
        <ContractImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onImport={onImportContract}
          isLoading={isLoading}
        />
      )}
    </>
  );
}
