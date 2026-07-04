const User = require('../models/User');
const Payment = require('../models/Payment');
const { uploadToImgbb } = require('../utils/imgbb');

function computeNextDueDate(admissionDate, totalMonthsPaid) {
  const base = admissionDate ? new Date(admissionDate) : new Date();
  const paidThrough = new Date(base);
  paidThrough.setMonth(paidThrough.getMonth() + totalMonthsPaid);
  const nextDue = new Date(paidThrough);
  nextDue.setDate(nextDue.getDate() + 1);
  return nextDue;
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
    const { fullName, mobile, whatsappNumber, email, address, admissionDate, libraryFees, password } = req.body;

    if (!fullName) return res.status(400).json({ message: 'Full name is required' });

    const username = mobile
      ? mobile.trim().toLowerCase()
      : `student_${Date.now()}`;

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ message: 'A student with this mobile number already exists' });
    }

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
    const { fullName, mobile, whatsappNumber, email, address, admissionDate, libraryFees, isActive } = req.body;

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

    const student = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
      select: '-password',
    });

    if (!student) return res.status(404).json({ message: 'Student not found' });

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
