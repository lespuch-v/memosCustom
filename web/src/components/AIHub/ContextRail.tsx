import { HashIcon, Loader2Icon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  SIDEBAR_ROW_CLASSES,
  SIDEBAR_ROW_COUNT_RAIL_CLASSES,
  SidebarRowIconSlot,
  sidebarRowStateClasses,
} from "@/components/AppSidebar/SidebarRow";
import SidebarSection from "@/components/AppSidebar/SidebarSection";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAiContext } from "@/contexts/AiContext";
import { describeContextSelection, formatTokenCount } from "@/lib/ai-context";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";

/**
 * The AI Hub's note selection, rendered as a sidebar section rather than a page
 * panel: the rail has no room for the roomy chips the page used, so tags are the
 * same rows the tag section builds and the receipt is one line.
 *
 * It reads the selection from context instead of taking props, because it is
 * rendered by the app sidebar while the conversation it configures lives on the
 * AI route.
 */
const ContextRail = () => {
  const t = useTranslate();
  const { availableTags, selectedTags, toggleTag, clearTags, includeComments, setIncludeComments, estimate, estimateError, isEstimating } =
    useAiContext();
  const [query, setQuery] = useState("");

  const filteredTags = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized === "") return availableTags;
    return availableTags.filter((entry) => entry.tag.toLowerCase().includes(normalized));
  }, [availableTags, query]);

  const memoCount = estimate?.memoCount ?? 0;
  const estimatedTokens = estimate?.estimatedTokens ?? 0;
  const budgetTokens = estimate?.budgetTokens ?? 0;
  const overBudget = estimate !== undefined && !estimate.fits;
  const hasSelection = selectedTags.length > 0;

  return (
    <SidebarSection
      label={t("ai.context-title")}
      ariaLabel={t("ai.context-title")}
      action={
        hasSelection ? (
          <button type="button" onClick={clearTags} className="text-2xs text-muted-foreground hover:text-foreground">
            {t("ai.context-clear")}
          </button>
        ) : undefined
      }
    >
      <p className="px-2 pb-1 text-2xs leading-snug text-muted-foreground/70">{t("ai.context-description")}</p>

      <div className="relative pb-1">
        <SearchIcon
          className="pointer-events-none absolute inset-y-0 start-2 my-auto size-3.5 text-muted-foreground/60"
          strokeWidth={1.8}
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("ai.context-search-tags")}
          aria-label={t("ai.context-search-tags")}
          className="h-7 ps-7 text-ui"
        />
      </div>

      {availableTags.length === 0 ? (
        <p className="px-2 text-2xs text-muted-foreground/70">{t("ai.context-no-tags")}</p>
      ) : filteredTags.length === 0 ? (
        <p className="px-2 text-2xs text-muted-foreground/70">{t("ai.context-no-matching-tags")}</p>
      ) : (
        // Bounded so the receipt and the comment toggle stay in view: with an
        // unbounded list they sit below the fold and the user has to scroll to
        // learn whether the selection even fits.
        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto [scrollbar-width:thin]">
          {filteredTags.map((entry) => {
            const selected = selectedTags.includes(entry.tag);
            const state = selected ? "checked" : "idle";
            return (
              <button
                key={entry.tag}
                type="button"
                aria-pressed={selected || undefined}
                onClick={() => toggleTag(entry.tag)}
                className={cn(SIDEBAR_ROW_CLASSES, sidebarRowStateClasses(state))}
              >
                <SidebarRowIconSlot icon={HashIcon} />
                <span className="min-w-0 flex-1 truncate text-start">{entry.tag}</span>
                <span className={SIDEBAR_ROW_COUNT_RAIL_CLASSES}>{entry.count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 rounded-lg border border-border/70 bg-muted/30 px-2 py-1.5">
        <div className="flex items-center gap-1.5 text-2xs">
          {isEstimating ? (
            <Loader2Icon className="size-3 shrink-0 animate-spin text-muted-foreground" strokeWidth={2} />
          ) : overBudget ? (
            <TriangleAlertIcon className="size-3 shrink-0 text-destructive" strokeWidth={2} />
          ) : null}
          <span className={cn("tabular-nums", overBudget ? "text-destructive" : "text-muted-foreground")}>
            {isEstimating ? t("ai.context-estimating") : describeContextSelection(memoCount, estimatedTokens, budgetTokens)}
          </span>
        </div>
        {estimateError && <p className="mt-1 text-2xs text-destructive">{estimateError}</p>}
        {!isEstimating && !estimateError && overBudget && (
          <p className="mt-1 text-2xs text-destructive">
            {t("ai.context-over-budget", { over: formatTokenCount(estimatedTokens - budgetTokens) })}
          </p>
        )}
        {!hasSelection && !estimateError && <p className="mt-1 text-2xs text-muted-foreground/70">{t("ai.context-empty-warning")}</p>}
      </div>

      <label className="mt-1 flex items-start gap-2 px-2 py-1 text-2xs">
        <Switch
          checked={includeComments}
          onCheckedChange={setIncludeComments}
          disabled={!hasSelection}
          aria-label={t("ai.context-include-comments")}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-foreground">{t("ai.context-include-comments")}</span>
          <span className="text-muted-foreground/70">{t("ai.context-comments-hint")}</span>
        </span>
      </label>
    </SidebarSection>
  );
};

export default ContextRail;
