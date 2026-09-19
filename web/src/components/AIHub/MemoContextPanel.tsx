import { FileTextIcon, LoaderCircleIcon } from "lucide-react";
import { MemoView } from "@/components/MemoView";
import { useAiContext } from "@/contexts/AiContext";
import { useMemos } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import { useTranslate } from "@/utils/i18n";

/** How many notes the panel lists before it defers to the tag filter. */
const CONTEXT_PANEL_LIMIT = 50;

/**
 * The notes a turn will read, shown beside the conversation. The AI Hub used to
 * spend its left column on the selector; with that in the sidebar, this is the
 * space's real job: making the selection visible instead of only counted.
 *
 * The list resolves the same CEL filter the server selects with, through
 * ListMemos, which excludes comments by default. So it shows exactly the notes a
 * turn would read, not the comments that ride along with them. It deliberately
 * does not reuse PagedMemoList: that list is bound to the global filter context
 * and the window scroll, neither of which belongs in a panel.
 */
const MemoContextPanel = ({ className }: { className?: string }) => {
  const t = useTranslate();
  const { filter, estimate } = useAiContext();
  const hasSelection = filter !== "";

  const { data, isLoading, isError } = useMemos({
    filter,
    state: State.NORMAL,
    orderBy: "create_time desc",
    pageSize: CONTEXT_PANEL_LIMIT,
  });

  const memos = hasSelection ? (data?.memos ?? []) : [];
  const truncated = memos.length >= CONTEXT_PANEL_LIMIT;

  return (
    <section className={cn("flex flex-col", className)} aria-label={t("ai.panel-title")}>
      <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/70">
        <FileTextIcon className="size-3.5 text-muted-foreground" strokeWidth={1.8} />
        <h2 className="text-ui font-medium text-foreground">{t("ai.panel-title")}</h2>
        {hasSelection && estimate && <span className="ms-auto text-2xs tabular-nums text-muted-foreground/70">{estimate.memoCount}</span>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pt-2 [scrollbar-width:thin]">
        {!hasSelection ? (
          <p className="px-1 text-2xs leading-snug text-muted-foreground/70">{t("ai.panel-empty")}</p>
        ) : isLoading ? (
          <div className="flex justify-center py-6">
            <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" strokeWidth={2} />
          </div>
        ) : isError ? (
          <p className="px-1 text-2xs text-destructive">{t("ai.context-estimate-failed")}</p>
        ) : (
          <>
            {memos.map((memo) => (
              <MemoView key={memo.name} memo={memo} showVisibility showSpace={false} compact />
            ))}
            {truncated && (
              <p className="px-1 py-2 text-2xs text-muted-foreground/70">{t("ai.panel-truncated", { limit: CONTEXT_PANEL_LIMIT })}</p>
            )}
          </>
        )}

        {/* The server refuses a selection past its cap rather than trimming it, so
            the panel can never quietly show fewer notes than the model would read. */}
        {estimate !== undefined && !estimate.fits && <p className="px-1 py-2 text-2xs text-destructive">{t("ai.panel-over-budget")}</p>}
      </div>
    </section>
  );
};

export default MemoContextPanel;
