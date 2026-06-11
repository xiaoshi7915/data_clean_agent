import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
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
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { DataSourceConfig } from "@contracts/types";

interface DataSourceEditDialogProps {
  dataSourceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function DataSourceEditDialog({
  dataSourceId,
  open,
  onOpenChange,
  onSaved,
}: DataSourceEditDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [dbType, setDbType] = useState<DataSourceConfig["type"]>("mysql");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3306");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [connectionError, setConnectionError] = useState("");

  const utils = trpc.useUtils();
  const testConnection = trpc.explore.testConnection.useMutation();
  const testConnectionById = trpc.explore.testConnectionByDataSourceId.useMutation();
  const updateDataSource = trpc.session.updateDataSource.useMutation();

  useEffect(() => {
    if (!open || !dataSourceId) return;

    let cancelled = false;
    void (async () => {
      try {
        const { found, config } = await utils.session.getDataSource.fetch({ dataSourceId });
        if (cancelled || !found || !config?.dbConfig) return;
        setDisplayName(config.name);
        setDbType(config.type);
        setHost(config.dbConfig.host);
        setPort(String(config.dbConfig.port || 3306));
        setDatabase(config.dbConfig.database);
        setUsername(config.dbConfig.username);
        setPassword("");
        setConnectionStatus("idle");
        setConnectionError("");
      } catch {
        if (!cancelled) toast.error("加载数据源失败");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, dataSourceId, utils]);

  const buildConfig = (): DataSourceConfig | null => {
    if (!host || !database || !username) return null;
    return {
      type: dbType,
      name: displayName.trim() || database,
      dbConfig: {
        host,
        port: parseInt(port) || 3306,
        database,
        username,
        password,
      },
    };
  };

  const handleTestConnection = async () => {
    if (!dataSourceId) return;

    setConnectionStatus("testing");
    setConnectionError("");
    try {
      if (!password.trim()) {
        const result = await testConnectionById.mutateAsync({ dataSourceId });
        if (result.success) {
          setConnectionStatus("success");
          toast.success("连接成功");
        } else {
          setConnectionStatus("error");
          setConnectionError(result.error || "连接失败");
          toast.error(result.error || "连接失败");
        }
        return;
      }

      const config = buildConfig();
      if (!config?.dbConfig) return;

      const result = await testConnection.mutateAsync({
        config: config.dbConfig,
        dbType: config.type as "mysql" | "postgresql" | "sqlite" | "sqlserver" | "oracle",
      });
      if (result.success) {
        setConnectionStatus("success");
        toast.success("连接成功");
      } else {
        setConnectionStatus("error");
        setConnectionError(result.error || "连接失败");
        toast.error(result.error || "连接失败");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "连接失败";
      setConnectionStatus("error");
      setConnectionError(message);
      toast.error(message);
    }
  };

  const handleSave = async () => {
    if (!dataSourceId) return;
    const config = buildConfig();
    if (!config) return;

    try {
      const result = await updateDataSource.mutateAsync({
        dataSourceId,
        dataSource: config,
      });
      if (result.success) {
        toast.success("数据源已更新");
        onSaved();
        onOpenChange(false);
      } else {
        toast.error(result.error || "更新失败");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑数据源</DialogTitle>
          <DialogDescription>修改显示名称与数据库连接参数</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="edit-name">命名</Label>
            <Input
              id="edit-name"
              placeholder="例如：生产库订单表"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-host">主机地址</Label>
              <Input id="edit-host" value={host} onChange={(e) => setHost(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-port">端口</Label>
              <Input id="edit-port" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-database">数据库名</Label>
            <Input id="edit-database" value={database} onChange={(e) => setDatabase(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-username">用户名</Label>
              <Input id="edit-username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-password">密码</Label>
              <Input
                id="edit-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="留空则保持不变"
              />
            </div>
          </div>

          {connectionStatus === "success" && (
            <div className="flex items-center gap-2 text-sm text-emerald-500">
              <CheckCircle2 className="w-4 h-4" />
              连接成功
            </div>
          )}
          {connectionStatus === "error" && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4" />
              {connectionError || "连接失败"}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleTestConnection}
            disabled={connectionStatus === "testing" || !host || !database || !username}
          >
            {connectionStatus === "testing" ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                测试中...
              </>
            ) : (
              "测试连接"
            )}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={updateDataSource.isPending || !host || !database || !username}
          >
            {updateDataSource.isPending ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
