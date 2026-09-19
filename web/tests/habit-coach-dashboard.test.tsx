import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HabitCoachDashboard from "@/components/Habits/HabitCoachDashboard";
import { HabitDaySchema, HabitSchema, HabitSummarySchema } from "@/types/proto/api/v1/habit_service_pb";

const date = "2026-09-19";
const days = Array.from({ length: 14 }, (_, index) => `2026-09-${String(index + 5).padStart(2, "0")}`);

const makeSummary = (name: string, title: string, hits: number[], todayRecorded: boolean) =>
  create(HabitSummarySchema, {
    habit: create(HabitSchema, { name, title, minimumValue: 5, targetValue: 20, startDate: days[0] }),
    currentStreak: hits.length,
    consistencyPercent: Math.round((hits.length / days.length) * 100),
    recentDays: days
      .map((day, index) =>
        create(HabitDaySchema, {
          date: day,
          value: hits.includes(index) ? 20 : 0,
          recorded: hits.includes(index),
          successful: hits.includes(index),
          targetMet: hits.includes(index),
        }),
      )
      .concat(
        create(HabitDaySchema, {
          date,
          value: todayRecorded ? 20 : 0,
          recorded: todayRecorded,
          successful: todayRecorded,
          targetMet: todayRecorded,
        }),
      ),
  });

describe("HabitCoachDashboard", () => {
  it("connects a coaching insight to an all-habit daily board", () => {
    const walk = makeSummary("habits/walk", "Lunch walk", [0, 1, 2, 3, 4, 5, 6], true);
    const read = makeSummary("habits/read", "Read", [0, 1, 2, 3, 4, 5, 6, 8], false);
    const journal = makeSummary("habits/journal", "Journal", [1, 3, 5, 7, 9, 11, 13], true);
    const onLog = vi.fn();

    render(
      <HabitCoachDashboard
        habits={[walk.habit!, read.habit!, journal.habit!]}
        summaries={[walk, read, journal]}
        today={date}
        savingNames={new Set()}
        onLog={onLog}
        onUndo={vi.fn()}
        onOpenHabit={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Lunch walk and Read move together." })).toBeInTheDocument();
    expect(screen.getByText("2 of 3 logged today")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Log Read target" }));
    expect(onLog).toHaveBeenCalledWith(read);
  });

  it("keeps scheduled habits visible when they do not have summary data yet", () => {
    const walk = makeSummary("habits/walk", "Lunch walk", [0, 1, 2], false);
    const scheduled = create(HabitSchema, {
      name: "habits/swim",
      title: "Swim",
      minimumValue: 5,
      targetValue: 20,
      startDate: "2026-10-01",
    });

    render(
      <HabitCoachDashboard
        habits={[walk.habit!, scheduled]}
        summaries={[walk]}
        today={date}
        savingNames={new Set()}
        onLog={vi.fn()}
        onUndo={vi.fn()}
        onOpenHabit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Open Swim" })).toBeInTheDocument();
    expect(screen.getByText("Starts 2026-10-01")).toBeInTheDocument();
  });
});
