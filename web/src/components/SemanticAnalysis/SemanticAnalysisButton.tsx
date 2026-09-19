import { SparklesIcon } from "lucide-react";
import { type MouseEvent, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOptionalSemanticAnalysis } from "@/contexts/SemanticAnalysisContext";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

const SemanticAnalysisButton = ({ memo }: { memo: Memo }) => {
  const t = useTranslate();
  const analysis = useOptionalSemanticAnalysis();
  useEffect(() => {
    if (analysis?.enabled) analysis.syncMemo(memo);
  }, [analysis, memo]);
  if (!analysis?.enabled) return null;
  const { openForMemo } = analysis;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => openForMemo(memo, event.currentTarget);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="quiet"
            size="icon-sm"
            className="text-indigo-500 hover:bg-indigo-500/10 hover:text-indigo-600"
            onClick={handleClick}
            aria-label={t("semantic-analysis.open")}
          />
        }
      >
        <SparklesIcon className="size-4" strokeWidth={1.8} />
      </TooltipTrigger>
      <TooltipContent>{t("semantic-analysis.open")}</TooltipContent>
    </Tooltip>
  );
};

export default SemanticAnalysisButton;
