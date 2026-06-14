/**
 * Singapore gazetted public holidays for 2026, keyed by ISO date (YYYY-MM-DD)
 * for O(1) lookup from the calendar grid. Dates that fall on a Sunday get an
 * observed Monday holiday "(in lieu)". Hari Raya dates follow the gazetted
 * civil calendar and may shift by a day on lunar confirmation.
 */
export const SG_HOLIDAYS_2026: Record<string, string> = {
  "2026-01-01": "New Year's Day",
  "2026-02-17": "Chinese New Year",
  "2026-02-18": "Chinese New Year",
  "2026-03-21": "Hari Raya Puasa",
  "2026-04-03": "Good Friday",
  "2026-05-01": "Labour Day",
  "2026-05-27": "Hari Raya Haji",
  "2026-05-31": "Vesak Day",
  "2026-06-01": "Vesak Day (in lieu)",
  "2026-08-09": "National Day",
  "2026-08-10": "National Day (in lieu)",
  "2026-11-08": "Deepavali",
  "2026-11-09": "Deepavali (in lieu)",
  "2026-12-25": "Christmas Day",
};

/** Holiday name for an ISO date, or null when it's an ordinary day. */
export function holidayName(iso: string): string | null {
  return SG_HOLIDAYS_2026[iso] ?? null;
}
