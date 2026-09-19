import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, render as testingLibraryRender } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AIHub from "@/pages/AIHub";
import { InstanceSetting_Key } from "@/types/proto/api/v1/instance_service_pb";

/** Chat is unconfigured, which is the state that shows the settings button. */
const instanceState = vi.hoisted(() => ({ fetchSetting: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/contexts/InstanceContext", () => ({
  useInstance: () => ({
    aiSetting: { providers: [], chat: undefined, transcription: undefined },
    fetchSetting: instanceState.fetchSetting,
    // The setting is already known, so the page shows the setup notice rather
    // than waiting for a fetch that will not change anything.
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

vi.mock("@/hooks/useAiChat", () => ({
  useAiChat: () => ({ messages: [], isSending: false, send: vi.fn(), resolveProposal: vi.fn() }),
}));

vi.mock("@/i18n", () => ({ default: { language: "en" } }));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

const Landing = () => {
  const location = useLocation();
  return <output data-testid="landing">{`${location.pathname}${location.hash}`}</output>;
};

describe("AI Hub settings shortcut", () => {
  beforeEach(() => {
    // `mockReset` is on globally, so the resolved value has to be restored here.
    instanceState.fetchSetting.mockReset();
    instanceState.fetchSetting.mockResolvedValue(undefined);
  });

  it("links into the AI section of settings with the setting already loaded", () => {
    testingLibraryRender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/ai"]}>
          <Routes>
            <Route path="/ai" element={<AIHub />} />
            <Route path="/setting" element={<Landing />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const shortcut = screen.getByRole("link", { name: /ai.open-settings/ });
    // An anchor, not a `role="button"` element: that override suppressed the
    // anchor's own Enter activation.
    expect(shortcut).toHaveAttribute("href", "/setting#ai");
    expect(shortcut).not.toHaveAttribute("role");

    // The setting is fetched on mount, so settings will not flash a loading state
    // and the click itself has nothing left to warm.
    expect(instanceState.fetchSetting).toHaveBeenCalledWith(InstanceSetting_Key.AI);

    fireEvent.click(shortcut);

    // The hash is what the sidebar reads to highlight the section.
    expect(screen.getByTestId("landing")).toHaveTextContent("/setting#ai");
  });

  it("activates on a plain click on the link itself", () => {
    testingLibraryRender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/ai"]}>
          <Routes>
            <Route path="/ai" element={<AIHub />} />
            <Route path="/setting" element={<Landing />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByText("ai.open-settings"));

    expect(screen.getByTestId("landing")).toHaveTextContent("/setting#ai");
    expect(screen.getByTestId("landing")).toHaveTextContent("/setting#ai");
  });

  it("keeps the chat thread out of the way while unconfigured", () => {
    testingLibraryRender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/ai"]}>
          <Routes>
            <Route path="/ai" element={<AIHub />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText("ai.not-configured")).toBeInTheDocument();
    expect(screen.queryByText("ai.panel-title")).not.toBeInTheDocument();
  });
});
