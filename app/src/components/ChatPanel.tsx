import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Bot, User, Zap } from "lucide-react";
import type { ChatMessage, ChatMessageAction } from "@contracts/types";
import { chatActionButtonClassName } from "@/lib/chatActionButton";
import {
  applyChatActionDisabledState,
  type ChatActionSessionContext,
} from "@/lib/chatActionState";
import { resolveActionRunIndex, resolveActionRevisionIndex } from "@/lib/chatActionRun";
import ReactMarkdown from "react-markdown";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  onMessageAction: (action: ChatMessageAction, message?: ChatMessage) => void;
  isLoading: boolean;
  /** 会话进度上下文，用于置灰已完成步骤的快捷按钮 */
  actionContext: ChatActionSessionContext;
  /** 历史 run 只读：禁用输入与发送 */
  readOnly?: boolean;
}

export function ChatPanel({
  messages,
  onSendMessage,
  onMessageAction,
  isLoading,
  actionContext,
  readOnly = false,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput("");
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-gradient-to-r from-sky-50/80 to-card/50 dark:from-sky-950/30 shrink-0">
        <Bot className="w-4 h-4 text-sky-600" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">数据清洗智能体</h3>
          <p className="text-[10px] text-muted-foreground">对话引导清洗流程</p>
        </div>
        {isLoading && <Zap className="w-3 h-3 text-sky-500 animate-pulse ml-auto" />}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <Bot className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">我是您的数据清洗助手</p>
              <p className="text-xs text-muted-foreground/60 mt-1">选择数据源开始清洗流程</p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  msg.role === "user"
                    ? "bg-primary/10"
                    : msg.role === "system"
                    ? "bg-destructive/10"
                    : "bg-emerald-500/10"
                }`}
              >
                {msg.role === "user" ? (
                  <User className="w-3 h-3 text-primary" />
                ) : msg.role === "system" ? (
                  <Zap className="w-3 h-3 text-destructive" />
                ) : (
                  <Bot className="w-3 h-3 text-emerald-500" />
                )}
              </div>
              <div className={`max-w-[85%] space-y-2 ${msg.role === "user" ? "items-end flex flex-col" : ""}`}>
                <div
                  className={`px-3 py-2 rounded-2xl text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-muted rounded-tl-sm"
                  }`}
                >
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="m-0 leading-relaxed">{children}</p>,
                        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                </div>
                {msg.role === "agent" && msg.actions && msg.actions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {applyChatActionDisabledState(msg.actions, actionContext)?.map((action) => (
                      <Button
                        key={action.id}
                        variant="outline"
                        size="sm"
                        className={`${chatActionButtonClassName} ${
                          action.disabled ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                        onClick={() => {
                          if (action.disabled) return;
                          const runIndex = resolveActionRunIndex(action, msg);
                          const revisionIndex = resolveActionRevisionIndex(action, msg);
                          onMessageAction(
                            {
                              ...action,
                              ...(runIndex != null ? { runIndex } : {}),
                              ...(revisionIndex != null ? { revisionIndex } : {}),
                            },
                            msg
                          );
                        }}
                        disabled={isLoading || action.disabled}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && messages[messages.length - 1]?.role !== "agent" && (
            <div className="flex gap-2.5">
              <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-3 h-3 text-emerald-500" />
              </div>
              <div className="bg-muted px-3 py-2 rounded-2xl rounded-tl-sm">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/30 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/30 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/30 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 border-t shrink-0 bg-card/30">
        <div className="flex gap-2">
          <Input
            placeholder={readOnly ? "历史快照只读，请切换到当前运行后再发送消息" : "输入消息或指令..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            disabled={isLoading || readOnly}
            className="text-sm"
          />
          <Button size="icon" onClick={handleSend} disabled={isLoading || readOnly || !input.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
