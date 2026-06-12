import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Database,
  Plus,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  Trash2,
  Pencil,
  Sparkles,
  MoreHorizontal,
  Inbox,
} from "lucide-react";
import type { CleaningPhase, SessionListItem, SavedDataSourceItem } from "@contracts/types";

interface SidebarProps {
  currentSessionId: string;
  sessionList: SessionListItem[];
  savedDataSources: SavedDataSourceItem[];
  onNewDataSource: () => void;
  onSelectSession: (sessionId: string) => void;
  onNewConversation: (dataSourceId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onEditDataSource?: (dataSourceId: string) => void;
  onDeleteDataSource?: (dataSourceId: string) => void;
  onGoHome: () => void;
}

const phaseLabel: Record<CleaningPhase, string> = {
  idle: "待开始",
  explore: "探查",
  analyze: "分析",
  confirm: "确认规则",
  generate: "生成SQL",
  execute: "执行",
  retry: "重试",
};

function sourceSubtitle(source: SavedDataSourceItem, sessionCount: number): string {
  const base = source.fileName
    ? source.fileName
    : source.dbDatabase
      ? `${source.type} · ${source.dbDatabase}`
      : source.type;
  return `${base} · ${sessionCount} 个对话`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function sessionLabel(session: SessionListItem): string {
  if (session.sessionTitle) return session.sessionTitle;
  if (session.targetTable) return `${session.targetTable} · ${phaseLabel[session.currentPhase]}`;
  return session.dataSourceName || session.sessionId.slice(0, 20);
}

/** 会话行删除按钮：outline 变体保证图标始终可见 */
const sessionDeleteBtnClass =
  "h-8 w-8 shrink-0 border-border/60 text-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/10";

/** 数据源行「更多」菜单触发器：固定尺寸、高对比度 */
const sourceMenuTriggerClass =
  "h-8 w-8 shrink-0 border-border/60 bg-muted/40 text-foreground hover:bg-muted hover:text-foreground";

function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
}: {
  session: SessionListItem;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`flex items-stretch gap-1 rounded-lg transition-colors ${
        isActive
          ? "bg-primary/12 ring-1 ring-primary/25 shadow-sm"
          : "hover:bg-accent/70"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className={`flex-1 min-w-0 text-left px-2.5 py-2 text-xs ${
          isActive ? "text-primary font-medium" : "text-muted-foreground"
        }`}
      >
        <p className="truncate">{sessionLabel(session)}</p>
        <p className="text-[10px] opacity-70 mt-0.5 truncate">
          {phaseLabel[session.currentPhase]} · {formatRelativeTime(session.updatedAt)}
        </p>
      </button>
      <div className="flex shrink-0 items-center pr-1">
        <Button
          variant="outline"
          size="icon-sm"
          className={sessionDeleteBtnClass}
          title="删除对话"
          aria-label="删除对话"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** 数据源行右侧「⋯」操作菜单，避免窄侧栏时三枚图标被挤出视口 */
function DataSourceActions({
  onEdit,
  onNewConversation,
  onDelete,
}: {
  onEdit?: () => void;
  onNewConversation: () => void;
  onDelete?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className={sourceMenuTriggerClass}
          title="数据源操作"
          aria-label="数据源操作"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {onEdit && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil className="w-4 h-4 mr-2" />
            编辑数据源
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onNewConversation();
          }}
        >
          <MessageCircle className="w-4 h-4 mr-2" />
          新建对话
        </DropdownMenuItem>
        {onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              删除数据源
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar({
  currentSessionId,
  sessionList,
  savedDataSources,
  onNewDataSource,
  onSelectSession,
  onNewConversation,
  onDeleteSession,
  onEditDataSource,
  onDeleteDataSource,
  onGoHome,
}: SidebarProps) {
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingDeleteSourceId, setPendingDeleteSourceId] = useState<string | null>(null);

  const sessionsBySource = useMemo(() => {
    const map = new Map<string, SessionListItem[]>();
    for (const session of sessionList) {
      const key = session.dataSourceId || "_orphan";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(session);
    }
    return map;
  }, [sessionList]);

  /** 当前会话所属数据源：默认折叠，选中会话时自动展开对应分组 */
  const activeDataSourceId = useMemo(() => {
    const current = sessionList.find((s) => s.sessionId === currentSessionId);
    return current?.dataSourceId;
  }, [sessionList, currentSessionId]);

  const toggleSource = (id: string) => {
    setExpandedSources((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const pendingSession = sessionList.find((s) => s.sessionId === pendingDeleteId);
  const pendingSource = savedDataSources.find((s) => s.dataSourceId === pendingDeleteSourceId);

  return (
    <div className="flex flex-col h-full bg-card/40">
      <div className="px-4 pt-4 pb-3 border-b space-y-3">
        <button
          type="button"
          onClick={onGoHome}
          className="w-full text-left px-1 py-1 -mx-1 rounded-lg cursor-pointer transition-colors hover:bg-sky-50/80 dark:hover:bg-sky-950/30 group"
          title="返回首页"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex shrink-0 items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight">数据清洗智能体</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">管理数据源与清洗对话</p>
            </div>
          </div>
        </button>
        <Button onClick={onNewDataSource} className="w-full gap-2" variant="default">
          <Plus className="w-4 h-4" />
          新建数据源
        </Button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <div className="px-4 pb-2 pt-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Database className="w-3 h-3" />
            已保存数据源
          </h3>
        </div>

        {/* 不用 ScrollArea，避免 Radix viewport 裁剪右侧操作区 */}
        <div className="flex-1 overflow-y-auto overflow-x-visible min-h-0 px-4">
          {savedDataSources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-3 text-center rounded-lg border border-dashed bg-muted/20">
              <Inbox className="w-8 h-8 text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground">连接后将自动保存数据源</p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">点击上方按钮开始</p>
            </div>
          ) : (
            <div className="space-y-2 pb-4">
              {savedDataSources.map((source) => {
                const sessions = sessionsBySource.get(source.dataSourceId) || [];
                const expanded =
                  expandedSources[source.dataSourceId] ??
                  (source.dataSourceId === activeDataSourceId && !!activeDataSourceId);
                return (
                  <div
                    key={source.dataSourceId}
                    className="rounded-lg border border-border/60 bg-card/80 shadow-sm overflow-visible"
                  >
                    {/* 第一行：展开箭头 + 名称（可截断）+ 固定宽度操作菜单 */}
                    <div className="flex w-full items-center gap-1 p-2">
                      <button
                        type="button"
                        onClick={() => toggleSource(source.dataSourceId)}
                        className="flex shrink-0 items-center justify-center h-8 w-8 rounded-md hover:bg-accent/60 transition-colors"
                        title={expanded ? "收起对话列表" : "展开对话列表"}
                        aria-label={expanded ? "收起对话列表" : "展开对话列表"}
                      >
                        {expanded ? (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleSource(source.dataSourceId)}
                        className="min-w-0 flex-1 overflow-hidden text-left py-0.5 pr-1 rounded-md hover:bg-accent/30 transition-colors"
                      >
                        <p className="text-xs font-medium truncate text-foreground">{source.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {sourceSubtitle(source, sessions.length)}
                        </p>
                      </button>
                      <div className="shrink-0 rounded-md bg-muted/40 p-0.5">
                        <DataSourceActions
                          onEdit={
                            onEditDataSource
                              ? () => onEditDataSource(source.dataSourceId)
                              : undefined
                          }
                          onNewConversation={() => onNewConversation(source.dataSourceId)}
                          onDelete={
                            onDeleteDataSource
                              ? () => setPendingDeleteSourceId(source.dataSourceId)
                              : undefined
                          }
                        />
                      </div>
                    </div>
                    {expanded && sessions.length > 0 && (
                      <div className="px-2 pb-2 pt-0.5 space-y-1 border-t border-border/40">
                        {sessions.map((session) => (
                          <SessionItem
                            key={session.sessionId}
                            session={session}
                            isActive={session.sessionId === currentSessionId}
                            onSelect={() => onSelectSession(session.sessionId)}
                            onDelete={() => setPendingDeleteId(session.sessionId)}
                          />
                        ))}
                      </div>
                    )}
                    {expanded && sessions.length === 0 && (
                      <p className="px-3 pb-2 text-[10px] text-muted-foreground/80 border-t border-border/40 pt-2">
                        暂无对话，点击 ⋯ 新建
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除此对话？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除「{pendingSession ? sessionLabel(pendingSession) : "该对话"}」及其探查报告、规则、SQL 与聊天记录，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDeleteId) {
                  onDeleteSession(pendingDeleteId);
                  setPendingDeleteId(null);
                }
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingDeleteSourceId}
        onOpenChange={(open) => !open && setPendingDeleteSourceId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除此数据源？</AlertDialogTitle>
            <AlertDialogDescription>
              将从侧栏隐藏「{pendingSource?.name ?? "该数据源"}」。已有清洗对话不会被删除，仍可在其他已保存数据源下打开。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDeleteSourceId && onDeleteDataSource) {
                  onDeleteDataSource(pendingDeleteSourceId);
                  setPendingDeleteSourceId(null);
                }
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
