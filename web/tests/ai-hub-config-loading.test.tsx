import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AIHub from "@/pages/AIHub";
import { InstanceSetting_AIProviderType, InstanceSetting_Key } from "@/types/proto/api/v1/instance_service_pb";

const api = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("@/connect", () => ({ aiServiceClient: api }));
vi.mock("@/lib/error", () => ({ handleError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("react-hot-toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/i18n", () => ({ default: { language: "en" } }));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

/**
 * The AI setting is not part of startup, so the page has to ask for it. These
 * tests pin that request and what the page shows while it is unanswered: the
 * page used to read the empty default and claim chat was not configured.
 */
const instance = vi.hoisted(() => ({
  aiSetting: { providers: [], chat: undefined } as {
    providers: { id: string; type: number }[];
    chat?: { providerId: string; model: string };
  },
  hasSetting: vi.fn(),
  fetchSetting: vi.fn(),
}));

vi.mock("@/contexts/InstanceContext", () => ({
  useInstance: () => ({
    aiSetting: instance.aiSetting,
    fetchSetting: instance.fetchSetting,
    hasSetting: instance.hasSetting,
  }),
}));

vi.mock("@/contexts/AiContext", () => ({
  useAiContext: () => ({
    filter: "",
    includeComments: false,
    estimate: undefined,
    estimateError: undefined,
  }),
}));

vi.mock("@/components/AIHub/MemoContextPanel", () => ({ default: () => <div data-testid="context-panel" /> }));
vi.mock("@/components/AIHub/ChatComposer", () => ({
  default: () => <div data-testid="composer" />,
}));

const CONFIGURED = {
  providers: [{ id: "openai-1", type: InstanceSetting_AIProviderType.OPENAI }],
  chat: { providerId: "openai-1", model: "gpt-4o-mini" },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

describe("AI Hub configuration loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instance.aiSetting = { providers: [], chat: undefined };
    instance.fetchSetting.mockResolvedValue(undefined);
  });

  it("asks for the AI setting on open, since startup does not load it", async () => {
    instance.hasSetting.mockReturnValue(false);

    render(<AIHub />, { wrapper });

    await waitFor(() => expect(instance.fetchSetting).toHaveBeenCalledWith(InstanceSetting_Key.AI));
  });

  it("waits instead of claiming chat is unconfigured while the setting is unknown", async () => {
    instance.hasSetting.mockReturnValue(false);

    render(<AIHub />, { wrapper });

    // The empty default is indistinguishable from a real "no provider" state, so
    // the page must not accuse the user of not configuring what they configured.
    expect(await screen.findByText("ai.loading-config")).toBeInTheDocument();
    expect(screen.queryByText("ai.not-configured")).not.toBeInTheDocument();
    expect(screen.queryByText("ai.open-settings")).not.toBeInTheDocument();
  });

  it("offers the settings shortcut once the setting is known to be empty", async () => {
    instance.hasSetting.mockReturnValue(true);

    render(<AIHub />, { wrapper });

    expect(await screen.findByText("ai.not-configured")).toBeInTheDocument();
    expect(screen.getByText("ai.open-settings")).toBeInTheDocument();
    expect(screen.queryByText("ai.loading-config")).not.toBeInTheDocument();
  });

  it("goes straight to the chat when the loaded setting is already configured", async () => {
    instance.hasSetting.mockReturnValue(true);
    instance.aiSetting = CONFIGURED;

    render(<AIHub />, { wrapper });

    // The reported bug: a configured instance showed the setup screen first.
    expect(await screen.findByTestId("composer")).toBeInTheDocument();
    expect(screen.queryByText("ai.not-configured")).not.toBeInTheDocument();
    expect(screen.queryByText("ai.loading-config")).not.toBeInTheDocument();
  });

  it("uses the default model when a provider is configured without a saved model", async () => {
    instance.hasSetting.mockReturnValue(true);
    instance.aiSetting = {
      providers: [{ id: "openai-1", type: InstanceSetting_AIProviderType.OPENAI }],
      chat: { providerId: "openai-1", model: "" },
    };

    render(<AIHub />, { wrapper });

    expect(await screen.findByTestId("composer")).toBeInTheDocument();
    expect(screen.queryByText("ai.not-configured")).not.toBeInTheDocument();
  });

  it("swaps the waiting state for the chat once the setting arrives", async () => {
    instance.hasSetting.mockReturnValue(false);
    const { rerender } = render(<AIHub />, { wrapper });

    expect(await screen.findByText("ai.loading-config")).toBeInTheDocument();

    // The fetch lands: the setting is now known and configured.
    instance.hasSetting.mockReturnValue(true);
    instance.aiSetting = CONFIGURED;
    rerender(<AIHub />);

    expect(await screen.findByTestId("composer")).toBeInTheDocument();
    expect(screen.queryByText("ai.loading-config")).not.toBeInTheDocument();
  });
});
