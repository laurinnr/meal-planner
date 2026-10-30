/** A calendar date as `YYYY-MM-DD`, with no time or zone. */
export type IsoDate = string;

const dayMs = 24 * 60 * 60 * 1000;

/**
 * The seven dates of the meal-plan week containing `date`, Monday first.
 * Works on UTC midnights, so the result never depends on the local time zone.
 */
export function weekDates(date: IsoDate): IsoDate[] {
  const day = parseIsoDate(date);
  // getUTCDay() counts from Sunday = 0; shift so Monday = 0.
  const monday = day.getTime() - ((day.getUTCDay() + 6) % 7) * dayMs;
  return Array.from({ length: 7 }, (_, i) =>
    new Date(monday + i * dayMs).toISOString().slice(0, 10),
  );
}

function parseIsoDate(date: IsoDate): Date {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  // Date rolls 2026-02-30 over to March; round-tripping catches that.
  if (parsed === null || parsed.toISOString().slice(0, 10) !== date) {
    throw new RangeError(`not a calendar date: ${date}`);
  }
  return parsed;
}
