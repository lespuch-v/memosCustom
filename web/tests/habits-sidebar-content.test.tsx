import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import HabitsSidebarContent from "@/components/AppSidebar/HabitsSidebarContent";
import { HabitSchema } from "@/types/proto/api/v1/habit_service_pb";

const mocks = vi.hoisted(() => ({ setMobileOpen: vi.fn() }));
const habits = [
  create(HabitSchema, { name: "habits/reading", title: "Reading", startDate: "2026-09-01" }),
  create(HabitSchema, { name: "habits/lunch-walk", title: "Lunch walk", startDate: "2026-10-01" }),
];

vi.mock("@/hooks/useHabits", () => ({
  useHabits: () => ({ data: habits, isLoading: false, isError: false }),
}));

vi.mock("@/contexts/AppSidebarContext", () => ({
  useAppSidebar: () => ({ setMobileOpen: mocks.setMobileOpen }),
}));

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
};

describe("HabitsSidebarContent", () => {
  it("shows summary and every habit, then keeps selection in the URL", () => {
    render(
      <MemoryRouter initialEntries={["/habits"]}>
        <HabitsSidebarContent />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Reading" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lunch walk" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Lunch walk" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/habits?habit=habits%2Flunch-walk");
    expect(screen.getByRole("link", { name: "Lunch walk" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(mocks.setMobileOpen).toHaveBeenCalledWith(false);
  });
});
