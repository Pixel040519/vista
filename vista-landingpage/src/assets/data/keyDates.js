// The admissions calendar on the website.
//
// It comes from VISTA: a super admin enters the school year's dates on the Key
// Dates page and ticks "Show on the school website", and
// GET /api/public/key-dates serves them (see src/assets/lib/publicContent.js).
//
// There is deliberately NO bundled fallback list. The five dates that used to
// live inline in Home.jsx and Admissions.jsx were placeholders nobody had
// confirmed, and they carried no year ("15 May") — so they could never be
// compared against today, and a stale date never looked stale. When VISTA has
// nothing to say the pages show the registrar's details instead, which is
// always true.

const LONG = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'long', year: 'numeric' });
const NO_YEAR = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'long' });
const DAY_ONLY = new Intl.DateTimeFormat('en-PH', { day: 'numeric' });

/**
 * The API sends plain YYYY-MM-DD strings (it casts the DATE columns in SQL), so
 * they are built as LOCAL dates here. `new Date('2026-06-08')` parses as UTC
 * midnight, which prints as the 7th anywhere west of Greenwich.
 */
const toDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/**
 * "8 June 2026" for a single day; a range drops whatever the two ends share, so
 * it reads "8–31 July 2026" within a month and "8 June – 31 July 2026" across
 * two. The year is always printed — that is the whole point.
 */
export function formatKeyDate(row) {
  const start = toDate(row.startsOn ?? row.starts_on);
  if (!start) return '';
  const end = toDate(row.endsOn ?? row.ends_on);
  if (!end || end.getTime() === start.getTime()) return LONG.format(start);

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const from = sameMonth ? DAY_ONLY.format(start) : sameYear ? NO_YEAR.format(start) : LONG.format(start);
  return `${from} – ${LONG.format(end)}`;
}

/** A row from the API → what AdmissionsTimeline renders. */
export function keyDateFromApi(row) {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    when: formatKeyDate(row),
  };
}
