export interface SchedulerClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
}

export function getZonedClock(date: Date, timezone: string): SchedulerClock {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdayToNumber: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dayOfWeek: weekdayToNumber[parts.weekday] ?? date.getDay(),
  };
}

export function getDateKeyFromClock(clock: SchedulerClock): string {
  return `${clock.year}-${clock.month}-${clock.day}`;
}

export function shouldRunDailyScheduledJob(
  clock: SchedulerClock,
  targetHour: number,
  targetMinute: number,
  lastRunDateKey: string | null,
): boolean {
  const dateKey = getDateKeyFromClock(clock);
  return clock.hour === targetHour && clock.minute === targetMinute && lastRunDateKey !== dateKey;
}
