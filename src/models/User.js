const mongoose = require('mongoose');

const ROLES = ['STUDENT', 'VIEWER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ROLES, default: 'STUDENT' },
    email: { type: String, lowercase: true, trim: true, sparse: true },
    mobile: { type: String, trim: true },
    whatsappNumber: { type: String, trim: true },
    photo: { type: String },
    address: { type: String, trim: true },
    admissionDate: { type: Date, default: Date.now },
    libraryFees: { type: Number, default: 0 },
    seatAssignments: [
      {
        _id: false,
        batch: { type: String, trim: true, required: true },
        seatNumber: { type: String, trim: true },
        remarks: { type: String, trim: true, default: '' },
      },
    ],
    isActive: { type: Boolean, default: true },
    // Date the student was most recently marked inactive. Cleared on readmission
    // (once the stint is archived into admissionHistory below).
    inactiveDate: { type: Date },
    // One entry per completed membership stint — preserves the original join
    // date and every inactive/readmission cycle even though `admissionDate`
    // itself is overwritten with the readmission date so due-date math
    // (computePaidThroughDate) always resets cleanly on rejoin.
    admissionHistory: [
      {
        _id: false,
        admissionDate: { type: Date, required: true },
        inactiveDate: { type: Date, required: true },
      },
    ],
    // The single stored due date — every screen (student card, profile,
    // dues report, seat map, student login) reads this field directly
    // instead of recomputing it, so they can never disagree with each
    // other. Maintained by services/dueDateService.recalculateNextDueDate,
    // called after every mutation that could change it (payment
    // create/delete, admissionDate edit, readmission).
    nextDueDate: { type: Date },
    // True once an admin has manually set nextDueDate (e.g. a student paid,
    // left immediately, and resumes later on the same payment — the admin
    // sets the resume date directly rather than fighting the payment-based
    // formula). While true, recalculateNextDueDate leaves nextDueDate alone;
    // recording a NEW payment always clears it, since a new payment is
    // unambiguous new truth.
    nextDueDateOverride: { type: Boolean, default: false },
    lastReminderSentAt: { type: Date },
    selfAdmission: { type: Boolean, default: false },
    verifiedByAdmin: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

userSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('User', userSchema);
