import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataSourcePanel } from "@/components/datasource/DataSourcePanel";
import type { DataSourceConfig } from "@contracts/types";

interface NewDataSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: DataSourceConfig) => Promise<boolean>;
  isLoading: boolean;
}

export function NewDataSourceDialog({
  open,
  onOpenChange,
  onSave,
  isLoading,
}: NewDataSourceDialogProps) {
  const handleConnect = async (config: DataSourceConfig) => {
    const ok = await onSave(config);
    if (ok) {
      toast.success("数据源已保存");
      onOpenChange(false);
    }
  };

  const handleFileUpload = async (
    filePath: string,
    fileType: "csv" | "json" | "xml" | "xlsx",
    fileName: string
  ) => {
    const displayName = fileName.replace(/\.[^.]+$/, "");
    const ok = await onSave({
      type: fileType,
      name: displayName || fileName,
      fileConfig: { fileName, fileSize: 0, fileType, filePath },
    });
    if (ok) {
      toast.success("文件已上传并保存");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新建数据源</DialogTitle>
          <DialogDescription>连接数据库或上传本地文件，保存后可在侧边栏新建清洗对话</DialogDescription>
        </DialogHeader>
        <DataSourcePanel
          compact
          isLoading={isLoading}
          onConnect={handleConnect}
          onFileUpload={handleFileUpload}
        />
      </DialogContent>
    </Dialog>
  );
}
