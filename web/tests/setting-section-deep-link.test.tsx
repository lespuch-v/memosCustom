import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Setting from "@/pages/Setting";

/** The rendered section is the only thing this test cares about, so the sections are stubs. */
const sectionCalls = vi.hoisted(() => ({ rendered: [] as string[] }));

vi.mock("@/components/Settings/settingSections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/Settings/settingSections")>();
  const stub = (key: string) => () => {
    sectionCalls.rendered.push(key);
    return <div data-testid="active-section">{key}</div>;
  };
  return {
    ...actual,
    SETTINGS_SECTIONS: actual.SETTINGS_SECTIONS.map((section) => ({ ...section, component: stub(section.key) })),
  };
});

vi.mock("@/contexts/InstanceContext", () => ({ useInstance: () => ({ fetchSettings: vi.fn() }) }));

const userState = vi.hoisted(() => ({ role: 2 }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ role: userState.role }) }));

describe("Setting deep link", () => {
  beforeEach(() => {
    sectionCalls.rendered = [];
    // Admin by default; the visibility test downgrades the visitor.
    userState.role = 2;
  });

  const renderAt = (entry: string) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/setting" element={<Setting />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("opens the section named by the query parameter", () => {
    // A query-parameter deep link still resolves, so an existing link or a
    // bookmarked one keeps working even though the AI Hub now links by hash.
    renderAt("/setting?section=ai");

    expect(screen.getByTestId("active-section")).toHaveTextContent("ai");
  });

  it("keeps opening the section named by the hash", () => {
    renderAt("/setting#storage");

    expect(screen.getByTestId("active-section")).toHaveTextContent("storage");
  });

  it("falls back to the default section when the route names none", () => {
    renderAt("/setting");

    expect(screen.getByTestId("active-section")).toHaveTextContent("my-account");
  });

  it("ignores a section the visitor may not see", () => {
    const host = renderAt("/setting?section=ai");
    expect(host.getByTestId("active-section")).toHaveTextContent("ai");
    host.unmount();

    // An admin-only section must not become reachable by naming it directly.
    userState.role = 1;
    renderAt("/setting?section=ai");

    expect(screen.getByTestId("active-section")).toHaveTextContent("my-account");
  });

  it("rewrites the route to the resolved section so the sidebar highlights it", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    // The sidebar reads the hash, which for a MemoryRouter entry is written to the
    // document location, so the assertion is on the document URL.
    window.history.replaceState(null, "", "/setting?section=ai");

    const { unmount } = renderAt("/setting?section=ai");

    // The sidebar reads the hash only, so the page has to publish what it chose.
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/setting#ai");
    // Relabelling the entry, not pushing a second one: one Back press must leave
    // settings, not step from the section to its own hash.
    expect(pushState).not.toHaveBeenCalled();

    replaceState.mockRestore();
    pushState.mockRestore();
    unmount();
  });
});
