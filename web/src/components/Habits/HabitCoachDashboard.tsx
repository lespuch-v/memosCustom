import { BookOpenIcon, CheckIcon, FootprintsIcon, MoonIcon, PenLineIcon, SparklesIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { buildHabitCoachModel, buildRoutineRhythm } from "@/lib/habit-coach";
import { cn } from "@/lib/utils";
import type { Habit, HabitSummary } from "@/types/proto/api/v1/habit_service_pb";

interface Props {
  habits: Habit[];
  summaries: HabitSummary[];
  today: string;
  savingNames: Set<string>;
  onLog: (summary: HabitSummary) => void;
  onUndo: (summary: HabitSummary) => void;
  onOpenHabit: (habit: Habit) => void;
}

const palette = [
  { tone: "text-indigo-600 dark:text-indigo-300", tint: "bg-indigo-500/10", stroke: "var(--primary)" },
  { tone: "text-emerald-700 dark:text-emerald-300", tint: "bg-emerald-500/10", stroke: "var(--success)" },
  { tone: "text-violet-700 dark:text-violet-300", tint: "bg-violet-500/10", stroke: "oklch(0.58 0.16 300)" },
  { tone: "text-rose-700 dark:text-rose-300", tint: "bg-rose-500/10", stroke: "oklch(0.58 0.14 15)" },
];

const icons = [FootprintsIcon, BookOpenIcon, PenLineIcon, MoonIcon];

const HabitCoachDashboard = ({ habits, summaries, today, savingNames, onLog, onUndo, onOpenHabit }: Props) => {
  const model = useMemo(() => buildHabitCoachModel(summaries), [summaries]);
  const summaryByName = useMemo(
    () => new Map(summaries.flatMap((summary) => (summary.habit ? [[summary.habit.name, summary] as const] : []))),
    [summaries],
  );
  const [selectedName, setSelectedName] = useState(model.insight?.fromName ?? summaries[0]?.habit?.name);
  const insight = model.insight;
  const completed = summaries.filter((summary) => summary.recentDays.some((day) => day.date === today && day.recorded)).length;
  const relatedNames = new Set(
    model.relationships
      .filter((pair) => pair.fromName === selectedName || pair.toName === selectedName)
      .flatMap((pair) => [pair.fromName, pair.toName]),
  );
  const chartDays = insight
    ? (summaries.find((summary) => summary.habit?.name === insight.fromName)?.recentDays.slice(-30) ?? [])
    : (summaries[0]?.recentDays.slice(-30) ?? []);
  const destinationDays = new Map(
    (summaries.find((summary) => summary.habit?.name === insight?.toName)?.recentDays ?? []).map((day) => [day.date, day]),
  );
  const rhythm = useMemo(() => buildRoutineRhythm(summaries), [summaries]);
  const visibleThreadNames = new Set(summaries.slice(0, 4).map((summary) => summary.habit?.name));

  return (
    <div className="space-y-8">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <article className="relative overflow-hidden rounded-[28px] border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="pointer-events-none absolute -bottom-28 -right-20 size-80 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              <span className="size-2 rounded-full bg-success shadow-[0_0_0_5px_color-mix(in_oklch,var(--success)_16%,transparent)]" />
              Coach&apos;s observation
            </div>
            {insight ? (
              <>
                <h2 className="mt-7 max-w-3xl font-serif text-3xl font-medium leading-[1.06] tracking-[-0.035em] text-foreground sm:text-5xl">
                  {insight.headline}
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-[15px]">{insight.explanation}</p>
                <div className="mt-6 flex flex-wrap items-center gap-2.5">
                  <Button
                    className="h-10 rounded-xl px-4 font-semibold shadow-sm"
                    onClick={() => document.getElementById("habit-coach-evidence")?.scrollIntoView({ behavior: "smooth" })}
                  >
                    Show the evidence
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    <b className="font-semibold text-foreground">{insight.confidence}</b> · {insight.bothTargetDays} matching days
                  </span>
                </div>
                <p className="mt-5 rounded-xl border border-primary/10 bg-primary/5 px-4 py-3 text-sm text-foreground">
                  <SparklesIcon className="mr-2 inline size-4 text-primary" />
                  <b>Try tomorrow:</b> {insight.experiment}
                </p>
              </>
            ) : (
              <>
                <h2 className="mt-7 max-w-2xl font-serif text-3xl font-medium leading-tight tracking-tight text-foreground sm:text-5xl">
                  Your routine is still introducing itself.
                </h2>
                <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">{model.emptyMessage}</p>
              </>
            )}
          </div>
        </article>

        <aside
          className="relative min-h-80 overflow-hidden rounded-[28px] border border-border bg-card p-5 shadow-sm"
          aria-label="Habit relationships"
        >
          <div>
            <h3 className="text-sm font-semibold text-foreground">The coach&apos;s thread</h3>
            <p className="text-xs text-muted-foreground">Select a habit to trace its associations.</p>
          </div>
          <svg
            className="absolute inset-x-4 bottom-2 top-14 h-[calc(100%-4rem)] w-[calc(100%-2rem)]"
            viewBox="0 0 360 250"
            aria-hidden="true"
          >
            {model.relationships
              .filter((pair) => visibleThreadNames.has(pair.fromName) && visibleThreadNames.has(pair.toName))
              .slice(0, 8)
              .map((pair, index) => {
                const fromIndex = summaries.findIndex((summary) => summary.habit?.name === pair.fromName);
                const toIndex = summaries.findIndex((summary) => summary.habit?.name === pair.toName);
                const points = [
                  [75, 72],
                  [282, 86],
                  [95, 203],
                  [270, 204],
                ];
                const from = points[fromIndex % points.length];
                const to = points[toIndex % points.length];
                if (!from || !to) return null;
                const active = pair.fromName === selectedName || pair.toName === selectedName;
                return (
                  <line
                    key={`${pair.fromName}:${pair.toName}:${index}`}
                    x1={from[0]}
                    y1={from[1]}
                    x2={to[0]}
                    y2={to[1]}
                    stroke={active ? "var(--primary)" : "var(--border)"}
                    strokeWidth={active ? 2.5 : 1}
                    strokeDasharray={pair.lift >= 1.15 ? undefined : "4 6"}
                    opacity={active ? 0.9 : 0.5}
                  />
                );
              })}
          </svg>
          <div className="absolute inset-x-5 bottom-5 top-16">
            {summaries.slice(0, 4).map((summary, index) => {
              const positions = ["left-[6%] top-[4%]", "right-[4%] top-[10%]", "left-[12%] bottom-[0%]", "right-[8%] bottom-[0%]"];
              const active = summary.habit?.name === selectedName;
              const dimmed = selectedName && !active && !relatedNames.has(summary.habit?.name ?? "");
              return (
                <button
                  key={summary.habit?.name}
                  type="button"
                  onClick={() => setSelectedName(summary.habit?.name)}
                  className={cn(
                    "absolute grid size-24 place-items-center rounded-full border bg-background/95 p-2 text-center shadow-md transition-all hover:scale-105 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    positions[index],
                    active && "scale-105 border-primary shadow-lg shadow-primary/15",
                    dimmed && "opacity-40",
                  )}
                >
                  <span className="relative z-10 text-xs font-semibold text-foreground">
                    {summary.habit?.title}
                    <small className="mt-0.5 block text-[9px] font-normal text-muted-foreground">
                      {summary.consistencyPercent}% steady
                    </small>
                  </span>
                  <span className="absolute inset-1.5 rounded-full border-[3px] border-primary/50 border-l-transparent" />
                </button>
              );
            })}
          </div>
        </aside>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Today</h2>
            <p className="text-xs text-muted-foreground">Keep the routine moving without opening each habit.</p>
          </div>
          <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-xs">
            {completed} of {habits.length} logged today
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {habits.map((habit, index) => {
            const summary = summaryByName.get(habit.name);
            const todayEntry = summary?.recentDays.find((day) => day.date === today);
            const recorded = Boolean(todayEntry?.recorded);
            const scheduled = habit.startDate > today;
            const Icon = icons[index % icons.length];
            const color = palette[index % palette.length];
            return (
              <article
                key={habit.name}
                className={cn("relative min-h-44 rounded-2xl border border-border bg-card p-4 shadow-xs", recorded && "bg-success/[0.035]")}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={cn("grid size-9 place-items-center rounded-xl", color.tint, color.tone)}>
                    <Icon className="size-4" />
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {scheduled ? "Scheduled" : recorded ? "Logged" : summary ? "Open" : "Unavailable"}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={`Open ${habit.title}`}
                  className="mt-4 text-left text-[15px] font-semibold text-foreground hover:underline"
                  onClick={() => onOpenHabit(habit)}
                >
                  {habit.title}
                </button>
                <p className="text-xs text-muted-foreground">
                  {scheduled
                    ? `Starts ${habit.startDate}`
                    : summary
                      ? `Target ${habit.targetValue} · ${summary.currentStreak} day streak`
                      : "Progress could not be loaded"}
                </p>
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {summary ? (
                      <>
                        <b className="text-foreground">{summary.consistencyPercent}%</b> steady
                      </>
                    ) : (
                      "Open for details"
                    )}
                  </span>
                  {scheduled || !summary ? null : recorded ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-lg px-3 text-xs"
                      disabled={savingNames.has(habit.name)}
                      aria-label={`Undo ${habit.title} log`}
                      onClick={() => onUndo(summary)}
                    >
                      <CheckIcon className="size-3.5 text-success" /> Undo
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-7 rounded-lg px-3 text-xs"
                      aria-label={`Log ${habit.title} target`}
                      disabled={savingNames.has(habit.name)}
                      onClick={() => onLog(summary)}
                    >
                      Log target
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="habit-coach-evidence" className="scroll-mt-6">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-foreground">Why the coach noticed</h2>
          <p className="text-xs text-muted-foreground">Inspect the pattern instead of taking the recommendation on faith.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {insight ? `${insight.fromTitle} ↔ ${insight.toTitle}` : "Daily target rhythm"}
                </h3>
                <p className="text-xs text-muted-foreground">Target completion by day</p>
              </div>
              {insight && (
                <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                  +{insight.liftPercent}% lift
                </span>
              )}
            </div>
            <div className="mt-6 h-52">
              <svg
                className="h-full w-full"
                viewBox="0 0 700 190"
                preserveAspectRatio="none"
                role="img"
                aria-label="Habit target completion evidence"
              >
                <line x1="0" y1="145" x2="700" y2="145" stroke="var(--border)" strokeDasharray="4 5" />
                {chartDays.map((day, index) => {
                  const x = chartDays.length > 1 ? (index / (chartDays.length - 1)) * 700 : 350;
                  const destination = destinationDays.get(day.date);
                  return (
                    <g key={day.date}>
                      <line
                        x1={x}
                        y1="145"
                        x2={x}
                        y2={day.targetMet ? 48 : 130}
                        stroke="var(--primary)"
                        strokeWidth="5"
                        opacity={day.targetMet ? 0.85 : 0.16}
                      />
                      {destination && (
                        <circle
                          cx={x}
                          cy={destination.targetMet ? 82 : 145}
                          r="4"
                          fill={destination.targetMet ? "var(--success)" : "var(--muted-foreground)"}
                          opacity={destination.targetMet ? 0.9 : 0.2}
                        />
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="flex flex-wrap gap-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
              <span>
                <i className="mr-1.5 inline-block size-2 rounded-full bg-primary" />
                Source target
              </span>
              <span>
                <i className="mr-1.5 inline-block size-2 rounded-full bg-success" />
                Paired target
              </span>
              <span>Association, not proof of cause</span>
            </div>
          </article>

          <aside className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground">Your weekly rhythm</h3>
            <p className="text-xs text-muted-foreground">Whole-routine completion</p>
            <div className="mt-5 grid grid-cols-7 gap-2">
              {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                <span key={`${day}-${index}`} className="text-center text-[9px] text-muted-foreground">
                  {day}
                </span>
              ))}
              {Array.from({ length: rhythm[0]?.weekdayIndex ?? 0 }, (_, index) => (
                <span key={`empty-${index}`} aria-hidden="true" />
              ))}
              {rhythm.map(({ date: rhythmDate, percentage }) => {
                return (
                  <span
                    key={rhythmDate}
                    className="aspect-square rounded-md bg-primary"
                    style={{ opacity: 0.12 + percentage / 120 }}
                    title={`${rhythmDate}: ${percentage}% complete`}
                  />
                );
              })}
            </div>
            <p className="mt-5 rounded-xl bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
              <b className="text-foreground">Look for repeatable days.</b> Brighter squares show when more of your routine landed together.
            </p>
          </aside>
        </div>
      </section>
    </div>
  );
};

export default HabitCoachDashboard;
