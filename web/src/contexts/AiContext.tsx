import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { aiServiceClient } from "@/connect";
import { useTagCounts } from "@/hooks/useUserQueries";
import { buildContextFilter } from "@/lib/ai-context";

/** Debounce for the context estimate, so toggling tags is not a request storm. */
const ESTIMATE_DEBOUNCE_MS = 300;

/** One resolved context estimate, as the server measured it. */
export interface ChatContextEstimate {
  memoCount: number;
  estimatedTokens: number;
  budgetTokens: number;
  fits: boolean;
}

interface AiContextValue {
  /** Tag names with note counts, from the same stats the sidebar uses. */
  availableTags: Array<{ tag: string; count: number }>;
  selectedTags: string[];
  toggleTag: (tag: string) => void;
  clearTags: () => void;
  /** Whether each selected note's comment thread is sent with a turn. */
  includeComments: boolean;
  setIncludeComments: (includeComments: boolean) => void;
  /** The CEL filter the selection resolves to. Empty means no notes. */
  filter: string;
  estimate: ChatContextEstimate | undefined;
  estimateError: string | undefined;
  isEstimating: boolean;
}

const AiContext = createContext<AiContextValue | null>(null);

/**
 * Owns the AI Hub's note selection. The selector lives in the app sidebar and the
 * conversation lives on the AI route, and those are siblings in the shell, so the
 * selection has to sit above both: one provider, two consumers, one source of truth.
 *
 * The provider stays mounted for the whole app because the sidebar renders the
 * selector on the AI route only. It costs nothing elsewhere: an empty selection is
 * an empty filter, and the estimate is skipped rather than sent.
 */
export const AiContextProvider = ({ children }: { children: ReactNode }) => {
  // The caller's own tags, matching the sidebar's tag section: these are the tags
  // whose notes this user can actually put in front of the model.
  const { data: tagCounts } = useTagCounts(true);

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [includeComments, setIncludeComments] = useState(false);
  const [estimate, setEstimate] = useState<ChatContextEstimate>();
  const [estimateError, setEstimateError] = useState<string>();
  const [isEstimating, setIsEstimating] = useState(false);

  const availableTags = useMemo(
    () =>
      Object.entries(tagCounts ?? {})
        .map(([tag, count]) => ({ tag, count }))
        .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag)),
    [tagCounts],
  );

  const filter = useMemo(() => buildContextFilter(selectedTags), [selectedTags]);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((previous) => (previous.includes(tag) ? previous.filter((item) => item !== tag) : [...previous, tag]));
  }, []);

  const clearTags = useCallback(() => setSelectedTags([]), []);

  // Estimate the selection whenever it changes. The server resolves the filter
  // under the caller's access scope, so the numbers shown match what a turn
  // would actually read. Comments are excluded from the estimate because they
  // are resolved only when a turn is sent, so the toggle does not belong here.
  //
  // This effect depends on the filter alone. A translator or any other value that
  // changes identity per render would re-measure an unchanged selection.
  const requestIdRef = useRef(0);
  useEffect(() => {
    if (filter === "") {
      setEstimate(undefined);
      setEstimateError(undefined);
      setIsEstimating(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsEstimating(true);

    const timer = window.setTimeout(async () => {
      try {
        const response = await aiServiceClient.estimateChatContext({ filter });
        // Ignore a stale response that a newer selection already superseded.
        if (requestIdRef.current !== requestId) return;
        setEstimate({
          memoCount: Number(response.memoCount),
          estimatedTokens: Number(response.estimatedTokens),
          budgetTokens: Number(response.contextBudgetTokens),
          fits: response.fits,
        });
        setEstimateError(undefined);
      } catch (error: unknown) {
        if (requestIdRef.current !== requestId) return;
        setEstimate(undefined);
        // The server's message names the reason (over the note cap, a filter it
        // cannot compile), so it is shown as-is rather than flattened.
        setEstimateError(error instanceof Error ? error.message : String(error));
      } finally {
        if (requestIdRef.current === requestId) {
          setIsEstimating(false);
        }
      }
    }, ESTIMATE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      // A debounced request cancelled here never reaches its `finally`, so the
      // spinner has to be released on the way out as well.
      setIsEstimating(false);
    };
  }, [filter]);

  const value = useMemo(
    () => ({
      availableTags,
      selectedTags,
      toggleTag,
      clearTags,
      includeComments,
      setIncludeComments,
      filter,
      estimate,
      estimateError,
      isEstimating,
    }),
    [availableTags, selectedTags, toggleTag, clearTags, includeComments, filter, estimate, estimateError, isEstimating],
  );

  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
};

export const useAiContext = () => {
  const context = useContext(AiContext);
  if (!context) {
    throw new Error("useAiContext must be used within AiContextProvider");
  }
  return context;
};
