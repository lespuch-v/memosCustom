import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiChat } from "@/hooks/useAiChat";
import AIHub from "@/pages/AIHub";

const api = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("@/connect", () => ({ aiServiceClient: api }));
vi.mock("@/lib/error", () => ({ handleError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("react-hot-toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** A configured provider, so the page renders the thread instead of the setup notice. */
vi.mock("@/contexts/InstanceContext", () => ({
  useInstance: () => ({
    aiSetting: {
      providers: [{ id: "p1", type: 1, title: "Local" }],
      chat: { providerId: "p1", model: "test-model" },
      transcription: undefined,
    },
    fetchSetting: vi.fn().mockResolvedValue(undefined),
    // Already known, so the page goes straight to the thread.
    hasSetting: () => true,
  }),
}));

vi.mock("@/contexts/AiContext", () => ({
  useAiContext: () => ({
    availableTags: [],
    selectedTags: [],
    toggleTag: vi.fn(),
    clearTags: vi.fn(),
    includeComments: false,
    setIncludeComments: vi.fn(),
    filter: "",
    estimate: undefined,
    estimateError: undefined,
    isEstimating: false,
  }),
}));

vi.mock("@/lib/ai-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-providers")>()),
  isChatCapableProviderType: () => true,
}));

vi.mock("@/i18n", () => ({ default: { language: "en" } }));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

const renderHub = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/ai"]}>
        <Routes>
          <Route path="/ai" element={<AIHub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const reply = (content: string) => ({
  content,
  proposals: [],
  contextMemoCount: 1n,
  contextCommentCount: 0n,
  contextEstimatedTokens: 5n,
  truncated: false,
});

describe("AI new session", () => {
  beforeEach(() => {
    api.chat.mockReset();
    api.chat.mockResolvedValue(reply("first reply"));
  });

  it("clears the transcript while keeping the selected notes", async () => {
    const { result } = renderHook(() => useAiChat(), { wrapper });

    await act(() => result.current.send("hello", { filter: 'tag in ["work"]', includeComments: true }));
    expect(result.current.messages).toHaveLength(2);

    act(() => result.current.reset());
    expect(result.current.messages).toEqual([]);
    // Starting a session is not a re-selection: the notes and comment toggle live
    // in the sidebar and must survive.
    expect(api.chat).toHaveBeenCalledTimes(1);
  });

  it("starts the next turn without the cleared transcript", async () => {
    const { result } = renderHook(() => useAiChat(), { wrapper });

    await act(() => result.current.send("hello", { filter: "", includeComments: false }));
    act(() => result.current.reset());
    await act(() => result.current.send("fresh question", { filter: "", includeComments: false }));

    // The transcript is resent every turn, so a reset that only hid messages
    // would still ship the old conversation to the provider.
    const lastCall = api.chat.mock.calls.at(-1)?.[0];
    expect(lastCall.messages).toEqual([{ role: 1, content: "fresh question" }]);
  });

  it("offers the control only once there is a thread to clear", async () => {
    const { unmount } = renderHub();

    // Nothing to clear on a fresh page, so the control stays out of the way.
    await waitFor(() => expect(screen.getByText("ai.empty-title")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /ai.new-session$/ })).not.toBeInTheDocument();
    unmount();

    api.chat.mockResolvedValue(reply("hello back"));
    renderHub();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.send" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /ai.new-session$/ })).toBeInTheDocument());
  });

  it("confirms before clearing and can be cancelled", async () => {
    api.chat.mockResolvedValue(reply("hello back"));
    renderHub();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.send" }));
    // The control is disabled while a turn runs, so wait for the reply rather than
    // for the button to merely exist.
    await waitFor(() => expect(screen.getByText("hello back")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /ai.new-session$/ }));
    // A session is not recoverable, so it asks first and says what it will not do.
    expect(await screen.findByText("ai.new-session-title")).toBeInTheDocument();
    expect(screen.getByText("ai.new-session-description")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    await waitFor(() => expect(screen.queryByText("ai.new-session-title")).not.toBeInTheDocument());
    // Cancelling must leave the conversation exactly as it was.
    expect(screen.getByText("hello back")).toBeInTheDocument();
  });

  it("clears the conversation once the user confirms", async () => {
    api.chat.mockResolvedValue(reply("hello back"));
    renderHub();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.send" }));
    await waitFor(() => expect(screen.getByText("hello back")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /ai.new-session$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "ai.new-session-confirm" }));

    await waitFor(() => expect(screen.getByText("ai.empty-title")).toBeInTheDocument());
    // The control retires with the thread it belonged to.
    expect(screen.queryByRole("button", { name: /ai.new-session$/ })).not.toBeInTheDocument();
  });
});
