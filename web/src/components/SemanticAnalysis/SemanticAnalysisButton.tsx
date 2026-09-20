import { SparklesIcon } from "lucide-react";
import { type MouseEvent, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOptionalSemanticAnalysis } from "@/contexts/SemanticAnalysisContext";
import useMediaQuery from "@/hooks/useMediaQuery";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { SemanticAnalysisInspectorBody } from "./SemanticAnalysisInspector";

const SemanticAnalysisButton = ({ memo }: { memo: Memo }) => {
  const t = useTranslate();
  const analysis = useOptionalSemanticAnalysis();
  const desktop = useMediaQuery("sm");
  useEffect(() => {
    if (analysis?.enabled) analysis.syncMemo(memo);
  }, [analysis, memo]);
  if (!analysis?.enabled) return null;
  const { close, memo: activeMemo, open, openForMemo } = analysis;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => openForMemo(memo, event.currentTarget);
  const trigger = <Button variant="quiet" size="icon-sm" className="text-indigo-500 hover:bg-indigo-500/10 hover:text-indigo-600" onClick={handleClick} aria-label={t("semantic-analysis.open")}><SparklesIcon className="size-4" strokeWidth={1.8} /></Button>;

  if (desktop) {
    return (
      <Popover open={open && activeMemo?.name === memo.name} onOpenChange={(next) => !next && close()}>
        <PopoverTrigger render={trigger} />
        <PopoverContent side="right" align="start" sideOffset={8} className="w-80 max-w-[calc(100vw-2rem)] rounded-xl p-4" aria-label={t("semantic-analysis.title")}>
          <div className="mb-1 flex items-center gap-2 font-semibold"><SparklesIcon className="size-4 text-indigo-500" />{t("semantic-analysis.title")}</div>
          <p className="mb-5 text-xs text-muted-foreground">{t("semantic-analysis.ephemeral")}</p>
          <SemanticAnalysisInspectorBody />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent>{t("semantic-analysis.open")}</TooltipContent>
    </Tooltip>
  );
};

export default SemanticAnalysisButton;
