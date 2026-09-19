import { CircleIcon, HouseIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useAppSidebar } from "@/contexts/AppSidebarContext";
import { useHabits } from "@/hooks/useHabits";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/routes";
import { SIDEBAR_ROW_CLASSES, SidebarRowIconSlot, sidebarRowStateClasses } from "./SidebarRow";
import SidebarSection from "./SidebarSection";

const HabitsSidebarContent = () => {
  const { setMobileOpen } = useAppSidebar();
  const { data: habits = [], isLoading, isError } = useHabits();
  const [searchParams] = useSearchParams();
  const selectedName = searchParams.get("habit");
  const rowClasses = (current: boolean) => cn(SIDEBAR_ROW_CLASSES, sidebarRowStateClasses(current ? "current" : "idle"));

  return (
    <SidebarSection label="Habits">
      <Link
        to={ROUTES.HABITS}
        aria-current={!selectedName ? "page" : undefined}
        onClick={() => setMobileOpen(false)}
        className={rowClasses(!selectedName)}
      >
        <SidebarRowIconSlot icon={HouseIcon} />
        <span data-sidebar-label className="min-w-0 flex-1 truncate text-start">
          Home
        </span>
      </Link>
      {habits.map((habit) => {
        const current = selectedName === habit.name;
        return (
          <Link
            key={habit.name}
            to={{ pathname: ROUTES.HABITS, search: new URLSearchParams({ habit: habit.name }).toString() }}
            aria-current={current ? "page" : undefined}
            onClick={() => setMobileOpen(false)}
            className={rowClasses(current)}
          >
            <SidebarRowIconSlot icon={CircleIcon} />
            <span data-sidebar-label className="min-w-0 flex-1 truncate text-start">
              {habit.title}
            </span>
          </Link>
        );
      })}
      {isLoading && <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading habits…</p>}
      {isError && <p className="px-2 py-1.5 text-xs text-destructive">Habits could not be loaded.</p>}
    </SidebarSection>
  );
};

export default HabitsSidebarContent;
