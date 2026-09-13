const User = require('../models/User');
const Payment = require('../models/Payment');
const { computePaidThroughDate, computeNextDueDate } = require('../utils/paymentDates');

// The only function allowed to write User.nextDueDate. Every mutation that
// could change a student's due date (payment create/delete, admissionDate
// edit, readmission) must call this afterward, so every read path can just
// trust the stored field instead of recomputing it with its own query.
//
// clearOverride: true is used when a NEW payment is recorded (or on
// readmission) — a new payment is unambiguous new truth, so any previous
// manual override is discarded and the date is recomputed fresh. Without it,
// an existing override is left untouched (e.g. deleting a payment or editing
// admissionDate doesn't silently overwrite an admin's manual due date).
async function recalculateNextDueDate(studentId, { clearOverride = false } = {}) {
  const student = await User.findById(studentId);
  if (!student || student.role !== 'STUDENT') return null;

  if (clearOverride) {
    student.nextDueDateOverride = false;
  } else if (student.nextDueDateOverride) {
    return student.nextDueDate;
  }

  const payments = await Payment.find({ student: studentId })
    .select('receivedDate monthsCovered coversUntil')
    .lean();
  const paidThroughDate = computePaidThroughDate(student.admissionDate, payments);
  const dueDate = computeNextDueDate(paidThroughDate);

  student.nextDueDate = dueDate;
  await student.save();
  return dueDate;
}

module.exports = { recalculateNextDueDate };
