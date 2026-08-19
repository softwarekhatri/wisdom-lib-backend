const mongoose = require('mongoose');

const monthSchema = new mongoose.Schema(
  { year: { type: Number, required: true }, month: { type: Number, required: true, min: 1, max: 12 } },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0 },
    mode: { type: String, enum: ['cash', 'online'], default: 'cash' },
    referenceNo: { type: String, trim: true },
    receivedDate: { type: Date, required: true, default: Date.now },
    monthsCovered: [monthSchema],
    // periodStart/coversUntil: the actual date range this payment covers.
    // Populated for every coverage-bearing payment (whole-month or custom
    // partial period); absent on legacy payments and "no coverage" payments.
    periodStart: { type: Date },
    coversUntil: { type: Date },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

paymentSchema.index({ student: 1, receivedDate: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
