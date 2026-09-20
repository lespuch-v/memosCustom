import { Loader2Icon, RefreshCwIcon, SparklesIcon, XIcon } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useSemanticAnalysis } from "@/contexts/SemanticAnalysisContext";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { getSemanticAnalysisPlacement, type SemanticAnalysisPlacement } from "./placement";

const judgments = [
  ["idea", "ideaProbability"],
  ["task", "taskProbability"],
  ["journal", "journalProbability"],
  ["reference", "referenceProbability"],
  ["question", "questionProbability"],
  ["actionable", "actionableProbability"],
  ["time-sensitive", "timeSensitiveProbability"],
  ["revisit", "revisitProbability"],
  ["technical", "technicalProbability"],
] as const;

// Certainty tiers: one quiet cool ramp from faint to dominant, so the eye ranks
// signals by color before reading the numbers. The dominant tier takes the one
// bold gradient in the panel and tints its percent number to match.
const barTier = (probability: number) =>
  probability >= 90
    ? "bg-gradient-to-r from-indigo-600 to-red-500 dark:from-indigo-400 dark:to-red-400"
    : probability >= 75
      ? "bg-indigo-600 dark:bg-indigo-400"
      : probability >= 50
        ? "bg-indigo-400 dark:bg-indigo-500"
        : "bg-zinc-400 dark:bg-zinc-600";

export const SemanticAnalysisInspectorBody = () => {
  const t = useTranslate();
  const { result, status, error, refresh } = useSemanticAnalysis();
  if (status === "loading" && !result) {
    return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />{t("semantic-analysis.loading")}</div>;
  }
  if (status === "error" && !result) {
    return <div className="space-y-3 p-1"><p className="text-sm text-destructive">{error || t("semantic-analysis.error")}</p><Button variant="outline" onClick={refresh}>{t("semantic-analysis.retry")}</Button></div>;
  }
  if (!result) return null;
  // Zero-probability judgments carry no information; dropping them keeps the panel compact.
  const visible = judgments.flatMap(([label, field]) => {
    const probability = Math.round(result[field] * 100);
    return probability === 0 ? [] : [{ label, probability }];
  });
  return (
    <div className="space-y-3">
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("semantic-analysis.no-signals")}</p>
      ) : (
        <div className="space-y-2">
          {visible.map(({ label, probability }, index) => (
            <div key={label} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>{t(`semantic-analysis.${label}`)}</span>
                <span className={cn("tabular-nums text-muted-foreground", probability >= 90 && "text-red-600 dark:text-red-400")}>{probability}%</span>
              </div>
              <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                {/* 50% mark: the boundary between leaning and present. */}
                <div className="absolute inset-y-0 left-1/2 w-px bg-muted-foreground/25" />
                <div
                  className={cn("h-full rounded-full transition-[width] duration-700 ease-out animate-semantic-grow motion-reduce:animate-none motion-reduce:transition-none", barTier(probability))}
                  style={{ width: `${probability}%`, animationDelay: `${index * 45}ms` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-between border-t pt-2"><span className="text-xs text-muted-foreground">{result.model}</span><Button variant="ghost" size="sm" disabled={status === "loading"} onClick={refresh}>{status === "loading" ? <Loader2Icon className="mr-1 size-3.5 animate-spin" /> : <RefreshCwIcon className="mr-1 size-3.5" />}{t("semantic-analysis.analyze-again")}</Button></div>
    </div>
  );
};

const SemanticAnalysisInspector = () => {
  const t = useTranslate();
  const desktop = useMediaQuery("sm");
  const { anchorRef, open, close, memo } = useSemanticAnalysis();
  const [placement, setPlacement] = useState<SemanticAnalysisPlacement>();
  const [panelHeight, setPanelHeight] = useState<number>();
  const observerRef = useRef<ResizeObserver | null>(null);

  const updatePlacement = useCallback(() => {
    const anchor = anchorRef.current;
    if (anchor) setPlacement(getSemanticAnalysisPlacement(anchor.getBoundingClientRect(), window, panelHeight));
  }, [anchorRef, panelHeight]);

  // Measure the panel so placement can flip it upward when the card sits near
  // the viewport bottom; re-measure as content changes (loading → results).
  const attachPanel = useCallback((element: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;
    const measure = () => setPanelHeight(element.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  useLayoutEffect(() => {
    if (!open || !desktop) return;
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  // Re-anchor when the selected memo changes so switching sparkles moves the
  // panel to the new card, not just on open/close.
  }, [desktop, open, memo, updatePlacement]);

  if (!open) return null;
  if (desktop) {
    if (!placement) return null;
    return <aside ref={attachPanel} aria-label={t("semantic-analysis.title")} className="fixed z-dropdown w-80 overflow-y-auto rounded-xl border border-border bg-background p-3 shadow-xl" style={{ left: placement.left, top: placement.top, maxHeight: placement.maxHeight }}><div className="mb-1 flex items-center gap-2 font-semibold"><SparklesIcon className="size-4 text-indigo-500" />{t("semantic-analysis.title")}</div><p className="mb-3 text-xs text-muted-foreground">{t("semantic-analysis.ephemeral")}</p><SemanticAnalysisInspectorBody /><Button variant="ghost" size="icon-sm" className="absolute end-2 top-2" onClick={close} aria-label={t("common.close")}><XIcon className="size-4" /></Button></aside>;
  }
  return <Sheet open={open} onOpenChange={(next) => !next && close()}><SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-4"><SheetHeader className="p-0"><SheetTitle className="flex items-center gap-2"><SparklesIcon className="size-4 text-indigo-500" />{t("semantic-analysis.title")}</SheetTitle><SheetDescription>{t("semantic-analysis.ephemeral")}</SheetDescription></SheetHeader><SemanticAnalysisInspectorBody /></SheetContent></Sheet>;
};

export default SemanticAnalysisInspector;
