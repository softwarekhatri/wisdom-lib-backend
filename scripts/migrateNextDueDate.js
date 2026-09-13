// One-time backfill for User.nextDueDate — the new stored field that
// replaces on-the-fly due-date computation (see
// src/services/dueDateService.js and the User model comment above
// nextDueDate). Existing students have no value for it yet.
//
// Usage:
//   node scripts/migrateNextDueDate.js            # preview only, writes nothing
//   node scripts/migrateNextDueDate.js --apply     # actually writes the field
//
// Safety:
//   - Only ever touches STUDENT-role users.
//   - Writes ONLY the `nextDueDate` field via $set — never re-saves the full
//     document, so no other field (password, seatAssignments, etc.) can be
//     altered by this script even if the User schema changes later.
//   - Never touches nextDueDateOverride — it defaults to false for every
//     student, which is correct here since no student has a manual
//     override yet (that field is new).
//   - Idempotent: safe to run multiple times. Re-running after new payments
//     were recorded normally would just recompute the same values, since
//     computePaidThroughDate is a pure function of admissionDate + payments.
//   - Defaults to a dry run that prints exactly what would change; nothing
//     is written to the database unless --apply is passed.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Payment = require('../src/models/Payment');
const { computePaidThroughDate, computeNextDueDate } = require('../src/utils/paymentDates');

const APPLY = process.argv.includes('--apply');

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Mode: ${APPLY ? 'APPLY (writing to database)' : 'DRY RUN (no writes — pass --apply to write)'}`);

  const students = await User.find({ role: 'STUDENT' })
    .select('_id fullName admissionDate nextDueDate')
    .lean();
  console.log(`Found ${students.length} student(s).`);

  const ids = students.map((s) => s._id);
  const payments = await Payment.find({ student: { $in: ids } })
    .select('student receivedDate monthsCovered coversUntil')
    .lean();

  const paymentsByStudent = {};
  for (const p of payments) {
    const key = p.student.toString();
    (paymentsByStudent[key] ||= []).push(p);
  }

  let unchanged = 0;
  let toUpdate = 0;
  let errors = 0;

  for (const student of students) {
    try {
      const studentPayments = paymentsByStudent[student._id.toString()] || [];
      const paidThroughDate = computePaidThroughDate(student.admissionDate, studentPayments);
      const computedDueDate = computeNextDueDate(paidThroughDate);

      const currentValue = student.nextDueDate ? new Date(student.nextDueDate).getTime() : null;
      const newValue = computedDueDate.getTime();

      if (currentValue === newValue) {
        unchanged++;
        continue;
      }

      toUpdate++;
      console.log(
        `${APPLY ? 'UPDATE' : 'WOULD UPDATE'}: ${student.fullName} (${student._id}) ` +
          `${student.nextDueDate ? new Date(student.nextDueDate).toDateString() : '(none)'} -> ${computedDueDate.toDateString()}`,
      );

      if (APPLY) {
        // $set on exactly one field — no other field on this document is touched.
        await User.updateOne({ _id: student._id }, { $set: { nextDueDate: computedDueDate } });
      }
    } catch (err) {
      errors++;
      console.error(`ERROR computing due date for ${student.fullName} (${student._id}):`, err.message);
    }
  }

  console.log('---');
  console.log(`Unchanged: ${unchanged}`);
  console.log(`${APPLY ? 'Updated' : 'Would update'}: ${toUpdate}`);
  console.log(`Errors: ${errors}`);
  if (!APPLY && toUpdate > 0) {
    console.log('\nThis was a dry run — re-run with --apply to write these changes.');
  }

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
