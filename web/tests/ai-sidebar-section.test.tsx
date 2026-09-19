import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, render as testingLibraryRender, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppSidebar from "@/components/AppSidebar";
import { type MemoFilter } from "@/contexts/MemoFilterContext";
import { resolveCollectionRoute } from "@/router/routes";

const authState = vi.hoisted(() => ({ currentUser: { name: "users/test" } as { name: string } | undefined }));
const aiState = vi.hoisted(() => ({
  availableTags: [
    { tag: "work", count: 5 },
    { tag: "journal", count: 2 },
  ],
  selectedTags: [] as string[],
  toggleTag: vi.fn(),
  clearTags: vi.fn(),
  includeComments: false,
  setIncludeComments: vi.fn(),
  filter: "",
  estimate: undefined as { memoCount: number; estimatedTokens: number; budgetTokens: number; fits: boolean } | undefined,
  estimateError: undefined as string | undefined,
  isEstimating: false,
}));

vi.mock("@/components/MemosLogo", () => ({ default: () => <span>Memos logo</span> }));
vi.mock("@/components/MemoDisplaySettingMenu", () => ({ default: () => null }));
vi.mock("@/components/UserMenu", () => ({ default: () => <button type="button">User menu</button> }));
vi.mock("@/components/CreateSpaceDialog", () => ({ default: () => null }));
vi.mock("@/components/StatisticsView", () => ({ default: () => null }));
vi.mock("@/components/AppSidebar/TagsSection", () => ({ default: () => null }));

vi.mock("@/contexts/AiContext", () => ({ useAiContext: () => aiState }));

vi.mock("@/contexts/AppSidebarContext", () => ({
  useAppSidebar: () => ({
    attachmentSection: "all",
    setAttachmentSection: vi.fn(),
    inboxFilter: "all",
    setInboxFilter: vi.fn(),
    memoDetail: undefined,
    setMemoDetail: vi.fn(),
    mobileOpen: false,
    setMobileOpen: vi.fn(),
    quickFindOpen: false,
    setQuickFindOpen: vi.fn(),
    memoScope: "home",
    setMemoScope: vi.fn(),
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isInitialized: true }) }));
vi.mock("@/contexts/GlobalMemoEditorContext", () => ({
  useGlobalMemoEditor: () => ({ canOpen: true, openEditor: vi.fn() }),
}));
vi.mock("@/contexts/InstanceContext", () => ({ useInstance: () => ({ isInitialized: true }) }));

vi.mock("@/contexts/MemoFilterContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/MemoFilterContext")>()),
  useMemoFilterContext: () => ({ filters: [] as MemoFilter[], memoView: undefined, setMemoView: vi.fn() }),
}));

vi.mock("@/contexts/SpaceContext", () => ({
  useSpaceContext: () => {
    const { spaceName } = resolveCollectionRoute(useLocation().pathname);
    return {
      spaces: [],
      selectedSpace: undefined,
      selectSpace: vi.fn(),
      selectedSpaceName: spaceName,
      memoFilter: spaceName ? `space == ${JSON.stringify(spaceName)}` : undefined,
      duplicateSpaceTitles: new Set<string>(),
      isLoadingSpaces: false,
      isSpacesError: false,
    };
  },
}));

vi.mock("@/hooks/useCurrentUser", () => ({ default: () => authState.currentUser }));
vi.mock("@/hooks/useFilteredMemoStats", () => ({
  useFilteredMemoStats: () => ({ statistics: { activityStats: {}, timeBasis: "create_time" }, tags: {} }),
}));
vi.mock("@/hooks/useAttachmentLibrary", () => ({
  useAttachmentLibraryStats: () => ({ stats: { media: 0, documents: 0, audio: 0, unused: 0 } }),
}));
vi.mock("@/hooks/useMediaQuery", () => ({ default: () => true }));
vi.mock("@/hooks/useUserQueries", () => ({
  userKeys: { memoViews: (parent?: string) => ["users", "memoViews", parent] },
  useMemoViews: () => ({ data: [] }),
  useNotifications: () => ({ data: [] }),
  useUser: () => ({ data: undefined }),
  useTagCounts: () => ({ data: {} }),
}));

vi.mock("@/i18n", () => ({ default: { language: "en" } }));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

const render = (ui: Parameters<typeof testingLibraryRender>[0]) =>
  testingLibraryRender(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
  );

describe("AI context in the app sidebar", () => {
  beforeEach(() => {
    aiState.selectedTags = [];
    aiState.estimate = undefined;
    aiState.estimateError = undefined;
    aiState.toggleTag.mockClear();
    aiState.clearTags.mockClear();
    aiState.setIncludeComments.mockClear();
  });

  it("renders the note selection in the sidebar on the AI route", () => {
    render(
      <MemoryRouter initialEntries={["/ai"]}>
        <AppSidebar />
      </MemoryRouter>,
    );

    const section = screen.getByRole("region", { name: "ai.context-title" });
    // The rail belongs to the sidebar now, not to a panel on the page.
    expect(screen.getByRole("complementary")).toContainElement(section);
    expect(within(section).getByRole("button", { name: /work/ })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: /journal/ })).toBeInTheDocument();
  });

  it("toggles a tag from the sidebar row", () => {
    render(
      <MemoryRouter initialEntries={["/ai"]}>
        <AppSidebar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /journal/ }));
    expect(aiState.toggleTag).toHaveBeenCalledWith("journal");
  });

  it("keeps the rail out of every other route's sidebar", () => {
    for (const path of ["/", "/explore", "/attachments", "/inbox"]) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <AppSidebar />
        </MemoryRouter>,
      );

      expect(screen.queryByRole("region", { name: "ai.context-title" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("reports the measured selection and marks an over-budget one", () => {
    aiState.selectedTags = ["work"];
    aiState.estimate = { memoCount: 12, estimatedTokens: 4000, budgetTokens: 32000, fits: true };

    const { unmount } = render(
      <MemoryRouter initialEntries={["/ai"]}>
        <AppSidebar />
      </MemoryRouter>,
    );

    expect(screen.getByText("12 notes · ~4,000 / 32,000 tokens")).toBeInTheDocument();
    expect(screen.queryByText("ai.context-over-budget")).not.toBeInTheDocument();
    unmount();

    aiState.estimate = { memoCount: 12, estimatedTokens: 40000, budgetTokens: 32000, fits: false };
    render(
      <MemoryRouter initialEntries={["/ai"]}>
        <AppSidebar />
      </MemoryRouter>,
    );

    expect(screen.getByText("ai.context-over-budget")).toBeInTheDocument();
  });

  it("offers clearing only once something is selected", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/ai"]}>
        <AppSidebar />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "ai.context-clear" })).not.toBeInTheDocument();
    unmount();

    aiState.selectedTags = ["work"];
    render(
      <MemoryRouter initialEntries={["/ai"]}>
        <AppSidebar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "ai.context-clear" }));
    expect(aiState.clearTags).toHaveBeenCalled();
  });
});
