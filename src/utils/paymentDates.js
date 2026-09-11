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

  // On readmission, admissionDate jumps forward to the readmission date.
  // Payments received before that point belong to the PRIOR stint (the one
  // that ended when the student went inactive) and must not carry their
  // coverage — whole-months or coversUntil — into the new stint's due-date
  // math, or a readmitted-but-unpaid student would show a due date months
  // in the future instead of "due immediately".
  const currentStint = (payments || []).filter(
    (p) => !p.receivedDate || new Date(p.receivedDate) >= base,
  );

  const withCoversUntil = currentStint.filter((p) => p.coversUntil);
  if (withCoversUntil.length) {
    const latest = withCoversUntil.reduce(
      (latest, p) => (new Date(p.coversUntil) > latest ? new Date(p.coversUntil) : latest),
      new Date(withCoversUntil[0].coversUntil),
    );
    return latest > base ? latest : base;
  }

  const totalMonths = currentStint.reduce((sum, p) => sum + (p.monthsCovered?.length || 0), 0);
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
