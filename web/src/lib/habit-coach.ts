import type { HabitSummary } from "@/types/proto/api/v1/habit_service_pb";

export interface HabitRelationship {
  fromName: string;
  fromTitle: string;
  toName: string;
  toTitle: string;
  lift: number;
  liftPercent: number;
  jointDays: number;
  bothTargetDays: number;
  fromTargetDays: number;
  toTargetDays: number;
}

export interface HabitCoachInsight extends HabitRelationship {
  headline: string;
  explanation: string;
  experiment: string;
  confidence: "Early signal" | "Medium confidence" | "Strong pattern";
}

export interface HabitCoachModel {
  insight?: HabitCoachInsight;
  relationships: HabitRelationship[];
  emptyMessage?: string;
}

export interface RoutineRhythmDay {
  date: string;
  percentage: number;
  weekdayIndex: number;
}

const MIN_SHARED_DAYS = 7;
const MIN_TARGET_DAYS = 3;

const relationship = (from: HabitSummary, to: HabitSummary): HabitRelationship | undefined => {
  if (!from.habit || !to.habit) return undefined;
  const toDays = new Map(to.recentDays.map((day) => [day.date, day]));
  const shared = from.recentDays.flatMap((fromDay) => {
    const toDay = toDays.get(fromDay.date);
    return toDay ? [{ from: fromDay, to: toDay }] : [];
  });
  const fromTargetDays = shared.filter((day) => day.from.targetMet).length;
  const toTargetDays = shared.filter((day) => day.to.targetMet).length;
  const bothTargetDays = shared.filter((day) => day.from.targetMet && day.to.targetMet).length;
  if (shared.length < MIN_SHARED_DAYS || fromTargetDays < MIN_TARGET_DAYS || toTargetDays < MIN_TARGET_DAYS) return undefined;

  const baseline = toTargetDays / shared.length;
  const conditional = bothTargetDays / fromTargetDays;
  const lift = baseline > 0 ? conditional / baseline : 0;
  return {
    fromName: from.habit.name,
    fromTitle: from.habit.title,
    toName: to.habit.name,
    toTitle: to.habit.title,
    lift,
    liftPercent: Math.round((lift - 1) * 100),
    jointDays: shared.length,
    bothTargetDays,
    fromTargetDays,
    toTargetDays,
  };
};

const confidenceFor = (pair: HabitRelationship): HabitCoachInsight["confidence"] => {
  if (pair.jointDays >= 60 && pair.bothTargetDays >= 12) return "Strong pattern";
  if (pair.jointDays >= 21 && pair.bothTargetDays >= 7) return "Medium confidence";
  return "Early signal";
};

export const buildHabitCoachModel = (summaries: HabitSummary[]): HabitCoachModel => {
  const relationships = summaries
    .flatMap((from, fromIndex) => summaries.slice(fromIndex + 1).map((to) => relationship(from, to)))
    .filter((pair): pair is HabitRelationship => Boolean(pair))
    .sort((a, b) => b.lift - a.lift || b.bothTargetDays - a.bothTargetDays);
  const strongest = relationships.find((pair) => pair.lift >= 1.15 && pair.bothTargetDays >= MIN_TARGET_DAYS);

  if (!strongest) {
    return {
      relationships,
      emptyMessage: `Keep logging. The coach needs at least ${MIN_SHARED_DAYS} shared days with a few completed targets before suggesting an experiment.`,
    };
  }

  return {
    relationships,
    insight: {
      ...strongest,
      headline: `${strongest.fromTitle} and ${strongest.toTitle} move together.`,
      explanation: `You complete ${strongest.fromTitle} and ${strongest.toTitle} together ${strongest.liftPercent}% more often than their individual rates predict. This is an association worth testing, not proof of cause.`,
      experiment: `Tomorrow, pair ${strongest.fromTitle} with ${strongest.toTitle} and see whether the sequence feels easier.`,
      confidence: confidenceFor(strongest),
    },
  };
};

export const buildRoutineRhythm = (summaries: HabitSummary[]): RoutineRhythmDay[] => {
  const dates = [...new Set(summaries.flatMap((summary) => summary.recentDays.map((day) => day.date)))].sort().slice(-28);
  return dates.map((date) => {
    const targetCount = summaries.filter((summary) => summary.recentDays.find((day) => day.date === date)?.targetMet).length;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return { date, percentage: summaries.length ? Math.round((targetCount / summaries.length) * 100) : 0, weekdayIndex: (weekday + 6) % 7 };
  });
};
