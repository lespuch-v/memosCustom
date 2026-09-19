import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiContextProvider, useAiContext } from "@/contexts/AiContext";

const api = vi.hoisted(() => ({ estimateChatContext: vi.fn() }));
vi.mock("@/connect", () => ({ aiServiceClient: api }));

const tagCounts = vi.hoisted(() => ({ data: { journal: 2, work: 5 } as Record<string, number> | undefined }));
const tagCountArgs = vi.hoisted(() => ({ forCurrentUser: undefined as boolean | undefined }));
vi.mock("@/hooks/useUserQueries", () => ({
  useTagCounts: (forCurrentUser?: boolean) => {
    tagCountArgs.forCurrentUser = forCurrentUser;
    return { data: tagCounts.data };
  },
}));

vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AiContextProvider>{children}</AiContextProvider>
  </QueryClientProvider>
);

/** The provider debounces the estimate, so every assertion waits for the request. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 400)));

describe("AI context selection", () => {
  beforeEach(() => {
    tagCounts.data = { journal: 2, work: 5 };
    api.estimateChatContext.mockReset();
    api.estimateChatContext.mockResolvedValue({
      memoCount: 3n,
      totalChars: 40n,
      estimatedTokens: 10n,
      contextBudgetTokens: 32000n,
      fits: true,
    });
  });

  it("starts with nothing selected, so the model reads no notes", async () => {
    const { result } = renderHook(() => useAiContext(), { wrapper });

    expect(result.current.selectedTags).toEqual([]);
    // An empty filter is what the server reads as "no notes", never "all notes".
    expect(result.current.filter).toBe("");
    expect(result.current.includeComments).toBe(false);

    await settle();
    // An empty selection must not even ask the server to measure it.
    expect(api.estimateChatContext).not.toHaveBeenCalled();
  });

  it("orders available tags by count so the busiest ones are reachable first", () => {
    const { result } = renderHook(() => useAiContext(), { wrapper });

    expect(result.current.availableTags).toEqual([
      { tag: "work", count: 5 },
      { tag: "journal", count: 2 },
    ]);
    // The picker offers the caller's own tags, so a count always matches the notes
    // that tag can actually put in front of the model.
    expect(tagCountArgs.forCurrentUser).toBe(true);
  });

  it("builds the filter from the selected tags and reports the server's estimate", async () => {
    const { result } = renderHook(() => useAiContext(), { wrapper });

    act(() => result.current.toggleTag("journal"));

    expect(result.current.selectedTags).toEqual(["journal"]);
    expect(result.current.filter).toBe('tag in ["journal"]');

    await settle();
    expect(api.estimateChatContext).toHaveBeenCalledTimes(1);
    expect(api.estimateChatContext).toHaveBeenCalledWith({ filter: 'tag in ["journal"]' });
    await waitFor(() => expect(result.current.estimate).toEqual({ memoCount: 3, estimatedTokens: 10, budgetTokens: 32000, fits: true }));
  });

  it("toggles a tag off again and clears the estimate with the selection", async () => {
    const { result } = renderHook(() => useAiContext(), { wrapper });

    act(() => result.current.toggleTag("journal"));
    await settle();
    act(() => result.current.toggleTag("journal"));

    expect(result.current.selectedTags).toEqual([]);
    expect(result.current.filter).toBe("");
    await waitFor(() => expect(result.current.estimate).toBeUndefined());
  });

  it("clears every selected tag at once", () => {
    const { result } = renderHook(() => useAiContext(), { wrapper });

    act(() => result.current.toggleTag("journal"));
    act(() => result.current.toggleTag("work"));
    expect(result.current.selectedTags).toEqual(["journal", "work"]);

    act(() => result.current.clearTags());
    expect(result.current.selectedTags).toEqual([]);
  });

  it("keeps the comment toggle out of the estimate, which cannot count comments", async () => {
    const { result } = renderHook(() => useAiContext(), { wrapper });

    act(() => result.current.toggleTag("journal"));
    await settle();
    act(() => result.current.setIncludeComments(true));

    expect(result.current.includeComments).toBe(true);
    // Comments are resolved only when a turn is sent, so the toggle must not
    // re-measure the selection and move the receipt under the user.
    await settle();
    expect(api.estimateChatContext).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed estimate instead of leaving the receipt stale", async () => {
    api.estimateChatContext.mockRejectedValue(new Error("selection matches more than 500 notes"));

    const { result } = renderHook(() => useAiContext(), { wrapper });
    act(() => result.current.toggleTag("journal"));

    await waitFor(() => expect(result.current.estimateError).toBe("selection matches more than 500 notes"));
    expect(result.current.estimate).toBeUndefined();
  });

  it("releases the measuring state when a newer selection supersedes an in-flight estimate", async () => {
    const { result } = renderHook(() => useAiContext(), { wrapper });

    act(() => result.current.toggleTag("journal"));
    // Superseded before the debounce fires, so the first request never runs.
    act(() => result.current.toggleTag("work"));
    expect(result.current.isEstimating).toBe(true);

    await settle();
    await waitFor(() => expect(result.current.isEstimating).toBe(false));
    expect(api.estimateChatContext).toHaveBeenCalledTimes(1);
    expect(api.estimateChatContext).toHaveBeenCalledWith({ filter: 'tag in ["journal", "work"]' });
  });

  it("stops measuring when the selection is emptied mid-flight", async () => {
    const { result } = renderHook(() => useAiContext(), { wrapper });

    act(() => result.current.toggleTag("journal"));
    act(() => result.current.clearTags());

    expect(result.current.isEstimating).toBe(false);
    await settle();
    expect(api.estimateChatContext).not.toHaveBeenCalled();
  });
});
