import type { ReactNode, RefObject } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { aiServiceClient } from "@/connect";
import { useInstance } from "@/contexts/InstanceContext";
import { handleError } from "@/lib/error";
import type { AnalyzeMemoSemanticResponse } from "@/types/proto/api/v1/ai_service_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

type AnalysisState = "idle" | "loading" | "success" | "error";

interface SemanticAnalysisContextValue {
  enabled: boolean;
  open: boolean;
  memo?: Memo;
  result?: AnalyzeMemoSemanticResponse;
  status: AnalysisState;
  error?: string;
  openForMemo: (memo: Memo, trigger?: HTMLElement, anchor?: HTMLElement | null) => void;
  syncMemo: (memo: Memo) => void;
  close: () => void;
  refresh: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  anchorRef: RefObject<HTMLElement | null>;
}

const SemanticAnalysisContext = createContext<SemanticAnalysisContextValue | null>(null);

const revisionKey = (memo: Memo) => `${memo.name}:${memo.updateTime?.seconds ?? 0}:${memo.updateTime?.nanos ?? 0}:${memo.content}`;

export const SemanticAnalysisProvider = ({ children }: { children: ReactNode }) => {
  const { aiSetting } = useInstance();
  const [open, setOpen] = useState(false);
  const [memo, setMemo] = useState<Memo>();
  const [result, setResult] = useState<AnalyzeMemoSemanticResponse>();
  const [status, setStatus] = useState<AnalysisState>("idle");
  const [error, setError] = useState<string>();
  const cacheRef = useRef(new Map<string, AnalyzeMemoSemanticResponse>());
  const requestRef = useRef(0);
  const triggerRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);

  const analyze = useCallback(async (target: Memo, bypassCache = false) => {
    const request = ++requestRef.current;
    const key = revisionKey(target);
    const cached = cacheRef.current.get(key);
    if (cached && !bypassCache) {
      setResult(cached);
      setStatus("success");
      setError(undefined);
      return;
    }
    setStatus("loading");
    if (!bypassCache) setResult(undefined);
    setError(undefined);
    try {
      const response = await aiServiceClient.analyzeMemoSemantic({ memo: target.name });
      cacheRef.current.set(key, response);
      if (request === requestRef.current) {
        setResult(response);
        setStatus("success");
      }
    } catch (cause: unknown) {
      if (request === requestRef.current) {
        setError(cause instanceof Error ? cause.message : "Semantic analysis failed");
        setStatus("error");
      }
      await handleError(cause, () => undefined, { context: "Analyze memo semantics" });
    }
  }, []);

  const openForMemo = useCallback(
    (target: Memo, trigger?: HTMLElement, anchor?: HTMLElement | null) => {
      triggerRef.current = trigger ?? null;
      anchorRef.current = anchor ?? trigger ?? null;
      setMemo(target);
      setOpen(true);
      void analyze(target);
    },
    [analyze],
  );

  const close = useCallback(() => {
    requestRef.current += 1;
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const syncMemo = useCallback(
    (updated: Memo) => {
      if (!open || memo?.name !== updated.name || revisionKey(memo) === revisionKey(updated)) return;
      setMemo(updated);
      void analyze(updated);
    },
    [analyze, memo, open],
  );

  const refresh = useCallback(() => {
    if (memo) void analyze(memo, true);
  }, [analyze, memo]);

  const value = useMemo(
    () => ({ enabled: !!aiSetting?.semanticAnalysis?.providerId, open, memo, result, status, error, openForMemo, syncMemo, close, refresh, triggerRef, anchorRef }),
    [aiSetting?.semanticAnalysis?.providerId, open, memo, result, status, error, openForMemo, syncMemo, close, refresh],
  );
  return <SemanticAnalysisContext.Provider value={value}>{children}</SemanticAnalysisContext.Provider>;
};

export const useSemanticAnalysis = () => {
  const value = useContext(SemanticAnalysisContext);
  if (!value) throw new Error("useSemanticAnalysis must be used within SemanticAnalysisProvider");
  return value;
};

export const useOptionalSemanticAnalysis = () => useContext(SemanticAnalysisContext);
