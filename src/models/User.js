const mongoose = require('mongoose');

const ROLES = ['STUDENT', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];

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
    seatNumber: { type: String, trim: true },
    batch: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

userSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('User', userSchema);
