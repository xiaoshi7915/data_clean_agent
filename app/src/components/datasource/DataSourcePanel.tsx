import { useState, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Database,
  FileSpreadsheet,
  Upload,
  Server,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Globe,
  HardDrive,
  Search,
} from "lucide-react";
import type { DataSourceConfig } from "@contracts/types";
import { isDbExploreSupported } from "@contracts/dataSourceSupport";

interface DataSourcePanelProps {
  onConnect: (config: DataSourceConfig, table?: string) => void;
  onFileUpload: (filePath: string, fileType: "csv" | "json" | "xml" | "xlsx", fileName: string) => void;
  isLoading: boolean;
  /** 弹框内使用时隐藏底部特性说明 */
  compact?: boolean;
}

const dbTypes = [
  { value: "mysql", label: "MySQL", icon: <Database className="w-4 h-4" /> },
  { value: "postgresql", label: "PostgreSQL", icon: <Database className="w-4 h-4" /> },
  { value: "sqlite", label: "SQLite", icon: <HardDrive className="w-4 h-4" /> },
  { value: "sqlserver", label: "SQL Server", icon: <Server className="w-4 h-4" /> },
  { value: "oracle", label: "Oracle", icon: <Globe className="w-4 h-4" /> },
];

export function DataSourcePanel({ onConnect, onFileUpload, isLoading, compact }: DataSourcePanelProps) {
  const [activeTab, setActiveTab] = useState("database");
  const [dbType, setDbType] = useState("mysql");
  const [displayName, setDisplayName] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("3306");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [connectionError, setConnectionError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const testConnection = trpc.explore.testConnection.useMutation();

  const handleDBConnect = () => {
    if (!host || !database || !username) return;
    if (!isDbExploreSupported(dbType)) {
      toast.error("该数据库类型尚未支持，当前仅 MySQL 可探查与执行");
      return;
    }
    const config: DataSourceConfig = {
      type: dbType as DataSourceConfig["type"],
      name: displayName.trim() || database,
      dbConfig: {
        host,
        port: parseInt(port) || 3306,
        database,
        username,
        password,
      },
    };
    onConnect(config);
  };

  const handleTestConnection = async () => {
    if (!host || !database || !username) return;
    if (!isDbExploreSupported(dbType)) {
      toast.error("该数据库类型尚未支持，当前仅 MySQL 可测试连接");
      return;
    }

    setConnectionStatus("testing");
    setConnectionError("");
    try {
      const result = await testConnection.mutateAsync({
        config: {
          host,
          port: parseInt(port) || 3306,
          database,
          username,
          password,
        },
        dbType: dbType as "mysql" | "postgresql" | "sqlite" | "sqlserver" | "oracle",
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

  const handleFileUpload = async (file: File) => {
    setUploadStatus("uploading");
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        const message = result.error || `上传失败 (${response.status})`;
        setUploadStatus("error");
        setUploadError(message);
        toast.error(message);
        return;
      }

      setUploadStatus("success");
      toast.success("文件上传成功");
      onFileUpload(result.filePath, result.fileType, result.fileName);
    } catch (err) {
      const message = err instanceof Error ? err.message : "上传失败";
      setUploadStatus("error");
      setUploadError(message);
      toast.error(message);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const getPortForDB = (type: string) => {
    switch (type) {
      case "mysql": return "3306";
      case "postgresql": return "5432";
      case "sqlite": return "0";
      case "sqlserver": return "1433";
      case "oracle": return "1521";
      default: return "3306";
    }
  };

  const handleDatabaseChange = (value: string) => {
    setDatabase(value);
    if (!displayName.trim() && value.trim()) {
      setDisplayName(value.trim());
    }
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full max-w-2xl mx-auto">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="database" className="gap-2">
            <Database className="w-4 h-4" />
            数据库连接
          </TabsTrigger>
          <TabsTrigger value="file" className="gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            本地文件
          </TabsTrigger>
        </TabsList>

        <TabsContent value="database">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5 text-primary" />
                数据库连接配置
              </CardTitle>
              <CardDescription>
                当前已实现 MySQL / PostgreSQL 探查与 SQL 执行；SQLite、SQL Server、Oracle 显示为「即将支持」
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-5 gap-2">
                {dbTypes.map((db) => {
                  const supported = isDbExploreSupported(db.value);
                  return (
                  <button
                    key={db.value}
                    onClick={() => {
                      setDbType(db.value);
                      setPort(getPortForDB(db.value));
                    }}
                    className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                      dbType === db.value
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-primary/30 hover:bg-accent"
                    } ${!supported ? "opacity-70" : ""}`}
                  >
                    {db.icon}
                    <span className="text-xs font-medium">{db.label}</span>
                    {!supported && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400">即将支持</span>
                    )}
                  </button>
                  );
                })}
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="displayName">命名</Label>
                <Input
                  id="displayName"
                  placeholder="例如：生产库订单数据"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">留空时将使用数据库名作为显示名称</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="host">主机地址</Label>
                  <Input
                    id="host"
                    placeholder="localhost"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="port">端口</Label>
                  <Input
                    id="port"
                    placeholder="3306"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="database">数据库名</Label>
                <Input
                  id="database"
                  placeholder="my_database"
                  value={database}
                  onChange={(e) => handleDatabaseChange(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="username">用户名</Label>
                  <Input
                    id="username"
                    placeholder="root"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">密码</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
                <Shield className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-muted-foreground">
                  密码仅在会话期间使用，不会被存储到数据库。建议创建只读账号用于探查，使用有权限的账号执行清洗。
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

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={
                    connectionStatus === "testing" ||
                    !host ||
                    !database ||
                    !username ||
                    !isDbExploreSupported(dbType)
                  }
                  className="flex-1"
                >
                  {connectionStatus === "testing" ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      测试中...
                    </span>
                  ) : (
                    "测试连接"
                  )}
                </Button>
                <Button
                  onClick={handleDBConnect}
                  disabled={
                    isLoading ||
                    !host ||
                    !database ||
                    !username ||
                    !isDbExploreSupported(dbType)
                  }
                  className="flex-1"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      连接中...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Database className="w-4 h-4" />
                      连接数据源
                    </span>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="file">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-primary" />
                上传本地文件
              </CardTitle>
              <CardDescription>
                支持 CSV、JSON、XML、XLSX 格式，文件大小不超过 50MB
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center gap-3 p-10 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30 hover:bg-accent/50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json,.xml,.xlsx,.xls"
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                  className="hidden"
                />
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">
                    拖拽文件到此处，或点击上传
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    支持 CSV、JSON、XML、XLSX
                  </p>
                </div>
              </div>

              {uploadStatus === "uploading" && (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  上传中...
                </div>
              )}
              {uploadStatus === "success" && (
                <div className="flex items-center gap-2 text-sm text-emerald-500">
                  <CheckCircle2 className="w-4 h-4" />
                  文件上传成功，正在创建会话...
                </div>
              )}
              {uploadStatus === "error" && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="w-4 h-4" />
                  {uploadError || "上传失败，请重试"}
                </div>
              )}

              <div className="grid grid-cols-4 gap-2">
                {["CSV", "JSON", "XML", "XLSX"].map((type) => (
                  <div
                    key={type}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-muted/50"
                  >
                    <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">{type}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {!compact && (
        <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
          {[
            { icon: <Search className="w-5 h-5" />, title: "智能探查", desc: "自动识别Schema和数据类型" },
            { icon: <Shield className="w-5 h-5" />, title: "安全执行", desc: "备份+回滚，危险操作拦截" },
            { icon: <CheckCircle2 className="w-5 h-5" />, title: "人机协同", desc: "逐条确认，完全可控" },
          ].map((feature) => (
            <div key={feature.title} className="flex flex-col items-center text-center p-4 rounded-xl bg-card border">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-2">
                {feature.icon}
              </div>
              <h4 className="text-sm font-medium">{feature.title}</h4>
              <p className="text-xs text-muted-foreground mt-1">{feature.desc}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
