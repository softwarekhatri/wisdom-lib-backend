const { addMonths, addDays, differenceInCalendarDays } = require('date-fns');

// Single source of truth for "how far is this student paid up to".
//
// New-style payments (recorded after the covers-until feature shipped) store an
// explicit `coversUntil` date — the last day of coverage — on every payment that
// covers time. Once a student has at least one such payment, its `coversUntil`
// (the latest one, since coverage only ever extends forward) already bakes in
// every prior month/override, so it alone is authoritative.
//
// Students with only legacy payments (pre-feature, `monthsCovered` only, no
// `coversUntil`) fall back to the old whole-months-from-admission-date formula
// so historical data keeps working without a migration.
function computePaidThroughDate(admissionDate, payments) {
  const base = admissionDate ? new Date(admissionDate) : new Date();

  const withCoversUntil = (payments || []).filter((p) => p.coversUntil);
  if (withCoversUntil.length) {
    return withCoversUntil.reduce(
      (latest, p) => (new Date(p.coversUntil) > latest ? new Date(p.coversUntil) : latest),
      new Date(withCoversUntil[0].coversUntil),
    );
  }

  const totalMonths = (payments || []).reduce((sum, p) => sum + (p.monthsCovered?.length || 0), 0);
  return addMonths(base, totalMonths);
}

function computeNextDueDate(paidThroughDate) {
  return addDays(paidThroughDate, 1);
}

// Inclusive day count of a coverage period.
function coverageDurationDays(periodStart, coversUntil) {
  return differenceInCalendarDays(new Date(coversUntil), new Date(periodStart)) + 1;
}

module.exports = { computePaidThroughDate, computeNextDueDate, coverageDurationDays };
