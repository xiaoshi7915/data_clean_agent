import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SavedDataSourceItem } from "@contracts/types";

interface NewConversationDialogProps {
  dataSourceId: string | null;
  savedDataSources: SavedDataSourceItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (dataSourceId: string, title?: string) => Promise<void>;
  isLoading: boolean;
}

function sourceSubtitle(source: SavedDataSourceItem): string {
  if (source.fileName) return source.fileName;
  if (source.dbDatabase) return `${source.type} · ${source.dbDatabase}`;
  return source.type;
}

export function NewConversationDialog({
  dataSourceId,
  savedDataSources,
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: NewConversationDialogProps) {
  const [title, setTitle] = useState("");
  const source = savedDataSources.find((s) => s.dataSourceId === dataSourceId);

  useEffect(() => {
    if (open) setTitle("");
  }, [open, dataSourceId]);

  const handleConfirm = async () => {
    if (!dataSourceId) return;
    try {
      await onConfirm(dataSourceId, title.trim() || undefined);
      onOpenChange(false);
    } catch {
      // 保留弹框，由上层 toast / error 提示
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建清洗对话</DialogTitle>
          <DialogDescription>
            {source
              ? `基于数据源「${source.name}」（${sourceSubtitle(source)}）开始新的数据清洗会话`
              : "选择数据源后开始新的清洗对话"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="conv-title">对话名称（可选）</Label>
          <Input
            id="conv-title"
            placeholder="留空将自动生成名称"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isLoading) void handleConfirm();
            }}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            取消
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={isLoading || !dataSourceId}>
            {isLoading ? "创建中..." : "开始对话"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
