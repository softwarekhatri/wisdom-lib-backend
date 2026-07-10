const ExcelJS = require('exceljs');
const User = require('../models/User');
const Payment = require('../models/Payment');
const { uploadToImgbb } = require('../utils/imgbb');
const { BATCHES } = require('../utils/batches');

function computeNextDueDate(admissionDate, totalMonthsPaid) {
  const base = admissionDate ? new Date(admissionDate) : new Date();
  const paidThrough = new Date(base);
  paidThrough.setMonth(paidThrough.getMonth() + totalMonthsPaid);
  const nextDue = new Date(paidThrough);
  nextDue.setDate(nextDue.getDate() + 1);
  return nextDue;
}

// Accepts the raw seatAssignments field from the request body — either a JSON
// string (multipart/form-data) or an already-parsed array (JSON body) — and
// returns a normalized, validated array or throws with a user-facing message.
function parseSeatAssignments(raw) {
  if (raw === undefined) return undefined;
  let list = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try {
      list = JSON.parse(raw);
    } catch {
      throw new Error('Invalid seat assignments format');
    }
  }
  if (!Array.isArray(list)) throw new Error('Invalid seat assignments format');

  const cleaned = list
    .map(a => ({ batch: (a?.batch || '').trim(), seatNumber: (a?.seatNumber || '').trim() }))
    .filter(a => a.batch && a.seatNumber);

  const seenBatches = new Set();
  for (const a of cleaned) {
    if (seenBatches.has(a.batch)) {
      throw new Error(`Only one seat can be assigned per batch — duplicate entry for "${a.batch}"`);
    }
    seenBatches.add(a.batch);
  }

  return cleaned;
}

// Checks every (batch, seatNumber) pair against other active students and
// returns the first conflict found, or null.
async function findSeatConflicts(assignments, excludeId) {
  for (const { batch, seatNumber } of assignments) {
    const query = {
      role: 'STUDENT',
      isActive: true,
      seatAssignments: { $elemMatch: { batch, seatNumber } },
    };
    if (excludeId) query._id = { $ne: excludeId };
    const conflict = await User.findOne(query).select('fullName');
    if (conflict) {
      return `Seat ${seatNumber} is already occupied for batch ${batch} (${conflict.fullName})`;
    }
  }
  return null;
}

exports.listStudents = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const skip = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    const filter = { role: 'STUDENT' };
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
      ];
    }
    if (req.query.active !== undefined) filter.isActive = req.query.active === 'true';

    const [students, total] = await Promise.all([
      User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    // Single aggregate to get totalMonthsPaid per student (avoids N+1)
    const ids = students.map(s => s._id);
    const paymentCounts = await Payment.aggregate([
      { $match: { student: { $in: ids } } },
      { $unwind: '$monthsCovered' },
      { $group: { _id: '$student', totalMonths: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(paymentCounts.map(p => [p._id.toString(), p.totalMonths]));

    const enriched = students.map(s => ({
      ...s,
      nextDueDate: computeNextDueDate(s.admissionDate, countMap[s._id.toString()] || 0),
    }));

    res.json({ students: enriched, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.id).select('-password');
    if (!student || student.role !== 'STUDENT') {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Students can only view themselves
    if (req.user.role === 'STUDENT' && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const payments = await Payment.find({ student: student._id })
      .sort({ receivedDate: -1 })
      .populate('createdBy', 'fullName');

    const totalMonthsPaid = payments.reduce((sum, p) => sum + (p.monthsCovered?.length || 0), 0);
    const nextDueDate = computeNextDueDate(student.admissionDate, totalMonthsPaid);

    res.json({ student: { ...student.toObject(), nextDueDate }, payments });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createStudent = async (req, res) => {
  try {
    const { fullName, mobile, whatsappNumber, email, address, admissionDate, libraryFees, password, seatAssignments } = req.body;

    if (!fullName) return res.status(400).json({ message: 'Full name is required' });

    const username = mobile
      ? mobile.trim().toLowerCase()
      : `student_${Date.now()}`;

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ message: 'A student with this mobile number already exists' });
    }

    let assignments;
    try {
      assignments = parseSeatAssignments(seatAssignments) || [];
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    const conflictMessage = await findSeatConflicts(assignments);
    if (conflictMessage) return res.status(400).json({ message: conflictMessage });

    const photoUrl = req.file ? await uploadToImgbb(req.file.buffer, req.file.originalname) : undefined;

    const student = await User.create({
      fullName: fullName.trim(),
      username,
      password: password || '123456',
      role: 'STUDENT',
      email: email?.trim() || undefined,
      mobile: mobile?.trim() || undefined,
      whatsappNumber: whatsappNumber?.trim() || undefined,
      address: address?.trim() || undefined,
      admissionDate: admissionDate ? new Date(admissionDate) : new Date(),
      libraryFees: parseFloat(libraryFees) || 0,
      seatAssignments: assignments,
      photo: photoUrl,
      createdBy: req.user._id,
    });

    const obj = student.toObject();
    delete obj.password;
    res.status(201).json({ student: obj });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateStudent = async (req, res) => {
  try {
    const { fullName, mobile, whatsappNumber, email, address, admissionDate, libraryFees, isActive, seatAssignments } = req.body;

    const existing = await User.findById(req.params.id);
    if (!existing || existing.role !== 'STUDENT') {
      return res.status(404).json({ message: 'Student not found' });
    }

    const update = {};
    if (fullName !== undefined) update.fullName = fullName.trim();
    if (email !== undefined) update.email = email.trim() || undefined;
    if (address !== undefined) update.address = address.trim() || undefined;
    if (admissionDate !== undefined) update.admissionDate = new Date(admissionDate);
    if (libraryFees !== undefined) update.libraryFees = parseFloat(libraryFees);
    if (isActive !== undefined) update.isActive = isActive === true || isActive === 'true';
    if (whatsappNumber !== undefined) update.whatsappNumber = whatsappNumber.trim() || undefined;
    if (req.file) update.photo = await uploadToImgbb(req.file.buffer, req.file.originalname);

    if (mobile !== undefined) {
      update.mobile = mobile.trim();
      update.username = mobile.trim().toLowerCase();
    }

    if (seatAssignments !== undefined) {
      let assignments;
      try {
        assignments = parseSeatAssignments(seatAssignments) || [];
      } catch (err) {
        return res.status(400).json({ message: err.message });
      }
      const conflictMessage = await findSeatConflicts(assignments, req.params.id);
      if (conflictMessage) return res.status(400).json({ message: conflictMessage });
      update.seatAssignments = assignments;
    }

    const student = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
      select: '-password',
    });

    res.json({ student });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.id);
    if (!student || student.role !== 'STUDENT') {
      return res.status(404).json({ message: 'Student not found' });
    }
    await Payment.deleteMany({ student: student._id });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Student and all associated records deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: 'New password is required' });

    await User.findByIdAndUpdate(req.params.id, { password });
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getBatches = (req, res) => {
  res.json({ batches: BATCHES });
};

// Flattened, searchable view of every occupied seat across all batches —
// used by the admin "seat map" screen.
exports.getSeatMap = async (req, res) => {
  try {
    const batch = (req.query.batch || '').trim();
    const seatNumber = (req.query.seatNumber || '').trim();

    const pipeline = [
      { $match: { role: 'STUDENT', isActive: true, 'seatAssignments.0': { $exists: true } } },
      { $unwind: '$seatAssignments' },
    ];

    const unwoundMatch = {};
    if (batch) unwoundMatch['seatAssignments.batch'] = { $regex: batch, $options: 'i' };
    if (seatNumber) unwoundMatch['seatAssignments.seatNumber'] = { $regex: seatNumber, $options: 'i' };
    if (Object.keys(unwoundMatch).length) pipeline.push({ $match: unwoundMatch });

    pipeline.push(
      {
        $project: {
          _id: 0,
          studentId: '$_id',
          fullName: 1,
          mobile: 1,
          username: 1,
          batch: '$seatAssignments.batch',
          seatNumber: '$seatAssignments.seatNumber',
        },
      },
      { $sort: { batch: 1, seatNumber: 1 } }
    );

    const seats = await User.aggregate(pipeline);
    res.json({ seats });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.exportStudentsExcel = async (req, res) => {
  try {
    const students = await User.find({ role: 'STUDENT' }).sort({ createdAt: -1 }).lean();
    const ids = students.map(s => s._id);
    const paymentCounts = await Payment.aggregate([
      { $match: { student: { $in: ids } } },
      { $unwind: '$monthsCovered' },
      { $group: { _id: '$student', totalMonths: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(paymentCounts.map(p => [p._id.toString(), p.totalMonths]));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Students');

    sheet.columns = [
      { header: 'Full Name', key: 'fullName', width: 24 },
      { header: 'Username', key: 'username', width: 20 },
      { header: 'Mobile', key: 'mobile', width: 16 },
      { header: 'WhatsApp', key: 'whatsappNumber', width: 16 },
      { header: 'Email', key: 'email', width: 24 },
      { header: 'Address', key: 'address', width: 30 },
      { header: 'Admission Date', key: 'admissionDate', width: 16 },
      { header: 'Monthly Fees', key: 'libraryFees', width: 14 },
      { header: 'Seats (Batch: Seat)', key: 'seats', width: 40 },
      { header: 'Next Due Date', key: 'nextDueDate', width: 16 },
      { header: 'Active', key: 'isActive', width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };

    students.forEach(s => {
      const nextDueDate = computeNextDueDate(s.admissionDate, countMap[s._id.toString()] || 0);
      const seats = (s.seatAssignments || []).map(a => `${a.batch}: Seat ${a.seatNumber}`).join('; ');
      sheet.addRow({
        fullName: s.fullName,
        username: s.username,
        mobile: s.mobile || '',
        whatsappNumber: s.whatsappNumber || '',
        email: s.email || '',
        address: s.address || '',
        admissionDate: s.admissionDate ? new Date(s.admissionDate).toLocaleDateString('en-IN') : '',
        libraryFees: s.libraryFees || 0,
        seats: seats || 'Not decided',
        nextDueDate: nextDueDate ? nextDueDate.toLocaleDateString('en-IN') : '',
        isActive: s.isActive ? 'Active' : 'Inactive',
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="students.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
