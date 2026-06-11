import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Database,
  Plus,
  Clock,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  Trash2,
  Pencil,
  Sparkles,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

function sourceSubtitle(source: SavedDataSourceItem): string {
  if (source.fileName) return source.fileName;
  if (source.dbDatabase) return `${source.type} · ${source.dbDatabase}`;
  return source.type;
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
      className={`group flex items-stretch gap-0 rounded-md transition-colors overflow-visible pr-0.5 ${
        isActive ? "bg-primary/10" : "hover:bg-accent"
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
      <div className="flex shrink-0 w-8 items-center justify-center">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 opacity-60 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
          title="删除对话"
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

export function Sidebar({
  currentSessionId,
  sessionList,
  savedDataSources,
  onNewDataSource,
  onSelectSession,
  onNewConversation,
  onDeleteSession,
  onEditDataSource,
  onGoHome,
}: SidebarProps) {
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const sessionsBySource = useMemo(() => {
    const map = new Map<string, SessionListItem[]>();
    for (const session of sessionList) {
      const key = session.dataSourceId || "_orphan";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(session);
    }
    return map;
  }, [sessionList]);

  const toggleSource = (id: string) => {
    setExpandedSources((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const pendingSession = sessionList.find((s) => s.sessionId === pendingDeleteId);

  return (
    <div className="flex flex-col h-full bg-card/40">
      <div className="px-4 pt-4 pb-3 border-b space-y-3">
        <button
          type="button"
          onClick={onGoHome}
          className="w-full text-left px-1 py-1 -mx-1 rounded-md cursor-pointer transition-colors hover:bg-sky-50/80 dark:hover:bg-sky-950/30 group"
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
        <div className="p-4 pb-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Database className="w-3 h-3" />
            已保存数据源
          </h3>
        </div>
        <ScrollArea className="flex-1 px-4">
          {savedDataSources.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">连接后将自动保存数据源</p>
          ) : (
            <div className="space-y-1 pb-4">
              {savedDataSources.map((source) => {
                const sessions = sessionsBySource.get(source.dataSourceId) || [];
                const expanded = expandedSources[source.dataSourceId] ?? true;
                return (
                  <div key={source.dataSourceId} className="rounded-lg border bg-card/50 overflow-visible">
                    <div className="p-1.5 space-y-1">
                      <button
                        type="button"
                        onClick={() => toggleSource(source.dataSourceId)}
                        className="flex w-full min-w-0 items-center gap-2 p-1 text-left hover:bg-accent/50 rounded-md transition-colors"
                      >
                        {expanded ? (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{source.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{sourceSubtitle(source)}</p>
                        </div>
                      </button>
                      <div className="flex items-center justify-between gap-2 pl-5 pr-0.5">
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {sessions.length} 个对话
                        </span>
                        <div className="flex items-center gap-0.5">
                          {onEditDataSource && source.dbDatabase && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              title="编辑数据源"
                              onClick={() => onEditDataSource(source.dataSourceId)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            title="新建对话"
                            onClick={() => onNewConversation(source.dataSourceId)}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    {expanded && sessions.length > 0 && (
                      <div className="px-2 pb-2 space-y-0.5">
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
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <div className="p-4 border-t space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            最近会话
          </h3>
          {sessionList.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">暂无历史对话</p>
          ) : (
            <>
              <Select
                value={currentSessionId || undefined}
                onValueChange={(id) => onSelectSession(id)}
              >
                <SelectTrigger className="w-full h-8 text-xs bg-card/60 border-primary/20">
                  <SelectValue placeholder="选择历史会话…" />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {sessionList.map((session) => (
                    <SelectItem key={session.sessionId} value={session.sessionId} className="text-xs">
                      <span className="truncate">
                        {sessionLabel(session)}
                        <span className="text-muted-foreground ml-1">
                          · {phaseLabel[session.currentPhase]}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ScrollArea className="max-h-36">
                <div className="space-y-0.5">
                  {sessionList.slice(0, 8).map((session) => (
                    <SessionItem
                      key={session.sessionId}
                      session={session}
                      isActive={session.sessionId === currentSessionId}
                      onSelect={() => onSelectSession(session.sessionId)}
                      onDelete={() => setPendingDeleteId(session.sessionId)}
                    />
                  ))}
                </div>
              </ScrollArea>
            </>
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
    </div>
  );
}
