const Payment = require('../models/Payment');
const User = require('../models/User');

exports.addPayment = async (req, res) => {
  try {
    const { studentId, amount, mode, referenceNo, receivedDate, startYear, startMonth, numMonths, notes } = req.body;

    if (!studentId || !amount) {
      return res.status(400).json({ message: 'studentId and amount are required' });
    }

    const student = await User.findById(studentId);
    if (!student || student.role !== 'STUDENT') {
      return res.status(404).json({ message: 'Student not found' });
    }

    const monthsCovered = [];
    if (startYear && startMonth && numMonths) {
      let y = parseInt(startYear);
      let m = parseInt(startMonth);
      const n = parseInt(numMonths);
      for (let i = 0; i < n; i++) {
        monthsCovered.push({ year: y, month: m });
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }

    const payment = await Payment.create({
      student: studentId,
      amount: parseFloat(amount),
      mode: mode || 'cash',
      referenceNo: referenceNo?.trim() || undefined,
      receivedDate: receivedDate ? new Date(receivedDate) : new Date(),
      monthsCovered,
      notes: notes?.trim() || undefined,
      createdBy: req.user._id,
    });

    await payment.populate('createdBy', 'fullName');

    res.status(201).json({ payment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getStudentPayments = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const skip = (page - 1) * limit;

    // Students can only view their own payments
    if (req.user.role === 'STUDENT' && req.user._id.toString() !== req.params.studentId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const [payments, total] = await Promise.all([
      Payment.find({ student: req.params.studentId })
        .sort({ receivedDate: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'fullName'),
      Payment.countDocuments({ student: req.params.studentId }),
    ]);

    res.json({ payments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deletePayment = async (req, res) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);
    if (!payment) return res.status(404).json({ message: 'Payment not found' });
    res.json({ message: 'Payment deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getAllPayments = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const skip = (page - 1) * limit;
    const { startDate, endDate } = req.query;

    const query = {};
    if (startDate || endDate) {
      query.receivedDate = {};
      if (startDate) query.receivedDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.receivedDate.$lte = end;
      }
    }

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .sort({ receivedDate: -1 })
        .skip(skip)
        .limit(limit)
        .populate('student', 'fullName mobile photo')
        .populate('createdBy', 'fullName'),
      Payment.countDocuments(query),
    ]);

    const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);

    res.json({ payments, totalAmount, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
