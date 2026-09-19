import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { buildHabitCoachModel, buildRoutineRhythm } from "@/lib/habit-coach";
import { HabitDaySchema, HabitSchema, HabitSummarySchema } from "@/types/proto/api/v1/habit_service_pb";

const dates = Array.from({ length: 14 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`);

const summary = (name: string, title: string, hits: number[]) =>
  create(HabitSummarySchema, {
    habit: create(HabitSchema, { name, title, minimumValue: 1, targetValue: 1, startDate: dates[0] }),
    recentDays: dates.map((date, index) =>
      create(HabitDaySchema, {
        date,
        value: hits.includes(index) ? 1 : 0,
        recorded: hits.includes(index),
        successful: hits.includes(index),
        targetMet: hits.includes(index),
      }),
    ),
  });

describe("buildHabitCoachModel", () => {
  it("turns the strongest supported relationship into a cautious coaching experiment", () => {
    const walk = summary("habits/walk", "Lunch walk", [0, 1, 2, 3, 4, 5, 6]);
    const read = summary("habits/read", "Read", [0, 1, 2, 3, 4, 5, 6, 8]);
    const journal = summary("habits/journal", "Journal", [1, 3, 5, 7, 9, 11, 13]);

    const model = buildHabitCoachModel([walk, read, journal]);

    expect(model.insight).toMatchObject({ fromName: "habits/walk", toName: "habits/read", jointDays: 14, bothTargetDays: 7 });
    expect(model.insight?.headline).toBe("Lunch walk and Read move together.");
    expect(model.insight?.explanation).not.toMatch(/start|lead/i);
    expect(model.insight?.explanation).toContain("not proof of cause");
    expect(model.insight?.experiment).toContain("pair Lunch walk with Read");
    expect(model.insight?.liftPercent).toBeGreaterThan(0);
  });

  it("withholds a recommendation until a pair has enough shared evidence", () => {
    const first = summary("habits/first", "First", [0, 1, 2]);
    const second = summary("habits/second", "Second", [0, 1, 2]);
    first.recentDays = first.recentDays.slice(0, 5);
    second.recentDays = second.recentDays.slice(0, 5);

    const model = buildHabitCoachModel([first, second]);

    expect(model.insight).toBeUndefined();
    expect(model.emptyMessage).toContain("at least 7 shared days");
  });
});

describe("buildRoutineRhythm", () => {
  it("uses 28 distinct calendar days instead of repeating a shorter window", () => {
    const rhythmDates = Array.from({ length: 28 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);
    const first = summary("habits/first", "First", []);
    const second = summary("habits/second", "Second", []);
    first.recentDays = rhythmDates.map((date, index) => create(HabitDaySchema, { date, recorded: index === 0, targetMet: index === 0 }));
    second.recentDays = rhythmDates.map((date, index) => create(HabitDaySchema, { date, recorded: index === 0, targetMet: index === 0 }));

    const rhythm = buildRoutineRhythm([first, second]);

    expect(rhythm).toHaveLength(28);
    expect(rhythm[0]).toMatchObject({ date: "2026-08-01", percentage: 100, weekdayIndex: 5 });
    expect(rhythm[27]).toMatchObject({ date: "2026-08-28", percentage: 0 });
  });
});
