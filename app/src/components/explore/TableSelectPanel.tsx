import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Database, FileCode2, Loader2, Search, Table2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import type { DataSourceConfig, DatabaseTableInfo } from "@contracts/types";

function formatTableComment(comment: string): string {
  if (comment.length <= 20) return comment;
  return `${comment.slice(0, 20)}…`;
}

interface TableSelectPanelProps {
  dataSource: DataSourceConfig;
  sessionId?: string;
  selectedTable: string;
  onSelectTable: (table: string) => void;
  onExplore: (table: string) => void;
  onRunFullPipeline?: (table: string) => void | Promise<void>;
  isLoading: boolean;
  isPipelineRunning?: boolean;
  embedded?: boolean;
}

const footerButtonClassName =
  "flex-1 min-w-0 w-full bg-sky-100 hover:bg-sky-200 text-sky-900 border border-sky-200 dark:bg-sky-950/40 dark:hover:bg-sky-900/50 dark:text-sky-100 dark:border-sky-800";

export function TableSelectPanel({
  dataSource,
  sessionId,
  selectedTable,
  onSelectTable,
  onExplore,
  onRunFullPipeline,
  isLoading,
  isPipelineRunning = false,
  embedded = false,
}: TableSelectPanelProps) {
  const [search, setSearch] = useState("");
  const [tables, setTables] = useState<DatabaseTableInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const listTables = trpc.explore.listTables.useMutation();

  useEffect(() => {
    if (!dataSource.dbConfig) return;

    let cancelled = false;
    setLoadError(null);

    listTables
      .mutateAsync({
        sessionId,
        config: dataSource.dbConfig,
        dbType: dataSource.type as "mysql" | "postgresql" | "sqlite" | "sqlserver" | "oracle",
      })
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setTables(result.tables);
        } else {
          setLoadError(result.error || "加载表列表失败");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "加载表列表失败");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, dataSource.dbConfig?.host, dataSource.dbConfig?.database]);

  const filteredTables = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return tables;
    return tables.filter(
      (table) =>
        table.name.toLowerCase().includes(keyword) ||
        (table.comment?.toLowerCase().includes(keyword) ?? false)
    );
  }, [search, tables]);

  const loadingTables = listTables.isPending;

  return (
    <div className={`flex flex-col gap-6 w-full ${embedded ? "" : "items-center justify-center h-full px-6 max-w-xl mx-auto"}`}>
      {!embedded && (
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10">
            <Database className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold">选择要探查的数据表</h3>
          <p className="text-sm text-muted-foreground">
            数据源：{dataSource.name}
          </p>
        </div>
      )}
      {embedded && (
        <p className="text-sm text-muted-foreground">数据源：{dataSource.name}</p>
      )}

      <div className="w-full space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索表名或中文注释..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            disabled={loadingTables}
          />
        </div>

        <ScrollArea className="h-64 w-full rounded-lg border">
          {loadingTables ? (
            <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              正在加载表列表...
            </div>
          ) : loadError ? (
            <div className="p-4 text-sm text-destructive text-center">{loadError}</div>
          ) : filteredTables.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              {tables.length === 0 ? "该库下没有可用的数据表" : "没有匹配的表"}
            </div>
          ) : (
            <div className="p-1">
              {filteredTables.map((table) => {
                const isEmpty = table.rowCount === 0;
                const isSelected = selectedTable === table.name;
                return (
                  <button
                    key={table.name}
                    type="button"
                    onClick={() => onSelectTable(table.name)}
                    className={`flex items-center gap-2 w-full min-w-0 px-3 py-2.5 rounded-md text-left text-sm transition-colors ${
                      isSelected
                        ? isEmpty
                          ? "bg-muted text-muted-foreground font-medium"
                          : "bg-primary/10 text-primary font-medium"
                        : isEmpty
                        ? "text-muted-foreground/60 hover:bg-accent/50"
                        : "hover:bg-accent"
                    }`}
                  >
                    <div className="flex items-center gap-2 shrink-0 min-w-0">
                      <Table2 className={`w-4 h-4 shrink-0 ${isEmpty ? "opacity-50" : ""}`} />
                      <span className="font-mono shrink-0">{table.name}</span>
                      <span
                        className={`shrink-0 tabular-nums ${
                          isEmpty ? "text-muted-foreground/50" : "text-muted-foreground"
                        }`}
                      >
                        · {table.rowCount.toLocaleString()}行
                      </span>
                    </div>
                    {table.comment && (
                      <span
                        className="ml-auto shrink min-w-0 max-w-[45%] text-right text-muted-foreground truncate"
                        title={table.comment}
                      >
                        {formatTableComment(table.comment)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      <div className="flex w-full gap-2">
        <Button
          variant="outline"
          onClick={() => selectedTable && onExplore(selectedTable)}
          disabled={isLoading || isPipelineRunning || loadingTables || !selectedTable}
          className={footerButtonClassName}
        >
          {isLoading && !isPipelineRunning ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              探查中...
            </span>
          ) : (
            "开始探查"
          )}
        </Button>
        {onRunFullPipeline && (
          <Button
            variant="outline"
            onClick={() => selectedTable && onRunFullPipeline(selectedTable)}
            disabled={isLoading || isPipelineRunning || loadingTables || !selectedTable}
            className={footerButtonClassName}
          >
            {isPipelineRunning ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                生成中...
              </span>
            ) : (
              <>
                <FileCode2 className="w-4 h-4" />
                一键生成SQL
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
