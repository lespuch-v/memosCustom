import { ArrowUpRightIcon, Loader2Icon, NetworkIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { aiServiceClient } from "@/connect";
import useMediaQuery from "@/hooks/useMediaQuery";
import useNavigateTo from "@/hooks/useNavigateTo";
import { handleError } from "@/lib/error";
import type { RelatedMemoResult } from "@/types/proto/api/v1/ai_service_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

type RelatedNotesStatus = "loading" | "success" | "error";

// The three relationship probabilities in label order, so the strongest one can
// be shown under a result. Keep in sync with the server's Jev questions.
const relationships = [
  ["same-topic", "sameTopic"],
  ["same-problem", "sameProblem"],
  ["continuation", "continuation"],
] as const;

type RelationshipLabel = (typeof relationships)[number][0];

// Below this probability a relationship label reads as noise, so only the
// strongest one is shown and only when it clears the bar.
const RELATIONSHIP_LABEL_THRESHOLD = 0.5;

const strongestRelationship = (result: RelatedMemoResult): RelationshipLabel | undefined => {
  let label: RelationshipLabel | undefined;
  let value = 0;
  for (const [key, field] of relationships) {
    const probability = result[field];
    if (probability > value) {
      value = probability;
      label = key;
    }
  }
  return value >= RELATIONSHIP_LABEL_THRESHOLD ? label : undefined;
};

export default function RelatedNotesDialog({ memo, onOpenChange }: { memo: Memo; onOpenChange: (open: boolean) => void }) {
  const t = useTranslate();
  const navigateTo = useNavigateTo();
  const desktop = useMediaQuery("sm");
  const [status, setStatus] = useState<RelatedNotesStatus>("loading");
  const [results, setResults] = useState<RelatedMemoResult[]>();
  const [error, setError] = useState<string>();

  const findRelated = useCallback(async () => {
    setStatus("loading");
    setResults(undefined);
    setError(undefined);
    try {
      const response = await aiServiceClient.findRelatedMemos({ memo: memo.name });
      setResults(response.results);
      setStatus("success");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : undefined);
      setStatus("error");
      handleError(cause, () => undefined, { context: "Find related notes" });
    }
  }, [memo.name]);

  useEffect(() => {
    void findRelated();
  }, [findRelated]);

  const gotoMemo = (result: RelatedMemoResult) => {
    onOpenChange(false);
    navigateTo(`/${result.memo}`);
  };

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className="max-h-[88dvh] gap-0 overflow-hidden rounded-t-2xl sm:max-h-none sm:max-w-md sm:rounded-none"
      >
        <SheetHeader className="border-b px-5 py-5 pe-12">
          <SheetTitle className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <NetworkIcon className="size-4" />
            </span>
            {t("related-notes.title")}
          </SheetTitle>
          <SheetDescription>{t("related-notes.description")}</SheetDescription>
        </SheetHeader>
        {status === "loading" && (
          <div className="flex min-h-52 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {t("related-notes.loading")}
          </div>
        )}
        {status === "error" && (
          <div className="flex flex-1 flex-col items-start justify-center gap-3 px-5 py-10">
            <p className="text-sm text-destructive">{error || t("related-notes.error")}</p>
            <Button variant="outline" onClick={findRelated}>
              <RefreshCwIcon />
              {t("related-notes.retry")}
            </Button>
          </div>
        )}
        {status === "success" && (
          <>
            {!results?.length ? (
              <div className="flex min-h-52 flex-1 items-center px-5 py-10">
                <p className="text-sm text-muted-foreground">{t("related-notes.empty")}</p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {results.map((result, index) => {
                  const relationshipLabel = strongestRelationship(result);
                  const relevance = Math.round(result.relevance * 100);
                  return (
                    <button
                      key={result.memo}
                      /* Full-bleed row: the container has no horizontal padding, so the hover block spans the whole panel; px-5 keeps the content in the 20px gutter. */
                      className="group relative w-full px-5 py-2 text-left transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none"
                      onClick={() => gotoMemo(result)}
                    >
                      <div className="flex items-start gap-3">
                        {/* leading-6 mirrors the snippet's first line so the index and arrow sit on it, not above it. */}
                        <span className="text-xs leading-6 tabular-nums text-muted-foreground/60">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-3 text-sm leading-6 text-foreground">{result.snippet}</p>
                          <div className="mt-2 flex items-center justify-between gap-4">
                            <span className="text-xs font-medium text-muted-foreground">
                              {relationshipLabel ? t(`related-notes.${relationshipLabel}`) : t("related-notes.match")}
                            </span>
                            <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
                              <span
                                role="progressbar"
                                aria-label={t("related-notes.relevance")}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={relevance}
                                className="h-1 w-16 overflow-hidden rounded-full bg-muted"
                              >
                                <span
                                  className="block h-full origin-left animate-semantic-grow rounded-full bg-indigo-500 motion-reduce:animate-none"
                                  style={{ width: `${relevance}%`, animationDelay: `${index * 45}ms` }}
                                />
                              </span>
                              <span className="min-w-7 text-right">{relevance}%</span>
                            </span>
                          </div>
                        </div>
                        <span className="flex h-6 shrink-0 items-center text-muted-foreground/40 transition-colors group-hover:text-foreground">
                          <ArrowUpRightIcon className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex items-center justify-between border-t px-5 py-3">
              <span className="text-xs text-muted-foreground">{t("related-notes.ephemeral")}</span>
              <Button variant="ghost" size="sm" onClick={findRelated}>
                <RefreshCwIcon className="size-3.5" />
                {t("related-notes.refresh")}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
