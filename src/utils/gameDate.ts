/** Local calendar date as YYYY-MM-DD (avoids UTC shift from toISOString). */
export function formatLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Resolve Create Game picker labels to a real calendar date (source of truth). */
export function scheduledDateFromOption(
  option: 'Today' | 'Tomorrow' | 'This Weekend',
  now: Date = new Date()
): string {
  const today = startOfLocalDay(now);

  if (option === 'Today') {
    return formatLocalISODate(today);
  }

  if (option === 'Tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatLocalISODate(tomorrow);
  }

  // This Weekend → Saturday if Mon–Fri; keep Sat/Sun as the current weekend day.
  const weekend = new Date(today);
  const day = weekend.getDay(); // 0 Sun … 6 Sat
  if (day !== 0 && day !== 6) {
    weekend.setDate(weekend.getDate() + (6 - day));
  }
  return formatLocalISODate(weekend);
}

function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateStr.trim());
  if (us) {
    return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  }

  const fallback = new Date(dateStr);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * View-time label from scheduled date. Does not mutate or persist relative text.
 * Legacy rows that still store "Today" / "Tomorrow" / "This Weekend" pass through.
 */
export function formatGameDateLabel(dateStr: string, now: Date = new Date()): string {
  const trimmed = dateStr.trim();
  if (trimmed === 'Today' || trimmed === 'Tomorrow' || trimmed === 'This Weekend') {
    return trimmed;
  }

  const gameDate = parseLocalDate(trimmed);
  if (!gameDate) return dateStr;

  const today = startOfLocalDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const gameDay = startOfLocalDay(gameDate);

  if (gameDay.getTime() === today.getTime()) return 'Today';
  if (gameDay.getTime() === tomorrow.getTime()) return 'Tomorrow';

  return gameDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
