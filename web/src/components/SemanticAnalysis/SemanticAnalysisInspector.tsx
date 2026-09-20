import { Loader2Icon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useSemanticAnalysis } from "@/contexts/SemanticAnalysisContext";
import useMediaQuery from "@/hooks/useMediaQuery";
import { useTranslate } from "@/utils/i18n";

const judgments = [
  ["idea", "ideaProbability"],
  ["task", "taskProbability"],
  ["journal", "journalProbability"],
  ["reference", "referenceProbability"],
  ["actionable", "actionableProbability"],
  ["revisit", "revisitProbability"],
  ["technical", "technicalProbability"],
] as const;

export const SemanticAnalysisInspectorBody = () => {
  const t = useTranslate();
  const { result, status, error, refresh } = useSemanticAnalysis();
  if (status === "loading" && !result) {
    return <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />{t("semantic-analysis.loading")}</div>;
  }
  if (status === "error" && !result) {
    return <div className="space-y-4 p-1"><p className="text-sm text-destructive">{error || t("semantic-analysis.error")}</p><Button variant="outline" onClick={refresh}>{t("semantic-analysis.retry")}</Button></div>;
  }
  if (!result) return null;
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {judgments.map(([label, field]) => {
          const probability = Math.round(result[field] * 100);
          return <div key={label} className="space-y-1"><div className="flex justify-between text-sm"><span>{t(`semantic-analysis.${label}`)}</span><span className="tabular-nums text-muted-foreground">{probability}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${probability}%` }} /></div></div>;
        })}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-between border-t pt-3"><span className="text-xs text-muted-foreground">{result.model}</span><Button variant="ghost" size="sm" disabled={status === "loading"} onClick={refresh}>{status === "loading" ? <Loader2Icon className="mr-1 size-3.5 animate-spin" /> : <RefreshCwIcon className="mr-1 size-3.5" />}{t("semantic-analysis.analyze-again")}</Button></div>
    </div>
  );
};

const SemanticAnalysisInspector = () => {
  const t = useTranslate();
  const desktop = useMediaQuery("sm");
  const { open, close } = useSemanticAnalysis();
  if (desktop || !open) return null;
  return <Sheet open={open} onOpenChange={(next) => !next && close()}><SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-4"><SheetHeader className="p-0"><SheetTitle className="flex items-center gap-2"><SparklesIcon className="size-4 text-indigo-500" />{t("semantic-analysis.title")}</SheetTitle><SheetDescription>{t("semantic-analysis.ephemeral")}</SheetDescription></SheetHeader><SemanticAnalysisInspectorBody /></SheetContent></Sheet>;
};

export default SemanticAnalysisInspector;
