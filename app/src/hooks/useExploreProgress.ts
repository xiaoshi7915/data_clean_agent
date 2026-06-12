import { useEffect, useRef, useState } from "react";
import type { ExploreProgressStep } from "../../api/services/exploreProgressService";

export interface ExploreProgressState {
  step: ExploreProgressStep;
  message: string;
  columnIndex?: number;
  columnTotal?: number;
}

/** 订阅探查 SSE 进度（/api/explore/progress?sessionId=） */
export function useExploreProgress(sessionId: string | undefined, enabled: boolean) {
  const [progress, setProgress] = useState<ExploreProgressState | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId || !enabled) {
      setProgress(null);
      return;
    }

    const url = `/api/explore/progress?sessionId=${encodeURIComponent(sessionId)}`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          step: ExploreProgressStep;
          message: string;
          columnIndex?: number;
          columnTotal?: number;
        };
        setProgress({
          step: data.step,
          message: data.message,
          columnIndex: data.columnIndex,
          columnTotal: data.columnTotal,
        });
        if (data.step === "done" || data.step === "error") {
          source.close();
        }
      } catch {
        // 忽略心跳或非 JSON 行
      }
    };

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [sessionId, enabled]);

  return progress;
}
