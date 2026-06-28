const Payment = require('../models/Payment');
const User = require('../models/User');

exports.paymentReport = async (req, res) => {
  try {
    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const start = req.query.startDate ? new Date(req.query.startDate) : defaultStart;
    const end = req.query.endDate
      ? (() => { const d = new Date(req.query.endDate); d.setHours(23, 59, 59); return d; })()
      : defaultEnd;

    const payments = await Payment.find({ receivedDate: { $gte: start, $lte: end } })
      .populate('student', 'fullName mobile photo')
      .populate('createdBy', 'fullName')
      .sort({ receivedDate: 1 });

    const byDate = {};
    for (const p of payments) {
      const dateStr = p.receivedDate.toISOString().split('T')[0];
      if (!byDate[dateStr]) byDate[dateStr] = { date: dateStr, total: 0, count: 0, cash: 0, online: 0 };
      byDate[dateStr].total += p.amount;
      byDate[dateStr].count += 1;
      byDate[dateStr][p.mode] += p.amount;
    }

    const totalAmount = payments.reduce((s, p) => s + p.amount, 0);
    const cashTotal = payments.filter(p => p.mode === 'cash').reduce((s, p) => s + p.amount, 0);
    const onlineTotal = payments.filter(p => p.mode === 'online').reduce((s, p) => s + p.amount, 0);

    res.json({
      payments,
      chartData: Object.values(byDate),
      summary: { totalAmount, cashTotal, onlineTotal, count: payments.length, startDate: start, endDate: end },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.studentsWithDues = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const now = new Date();

    const students = await User.find({ role: 'STUDENT', isActive: true }).select('-password').lean();

    const enriched = await Promise.all(
      students.map(async (student) => {
        const allPayments = await Payment.find({ student: student._id }).lean();

        // Count total months paid across all payments
        let totalMonthsPaid = 0;
        for (const p of allPayments) {
          totalMonthsPaid += (p.monthsCovered || []).length;
        }

        // Due date = admissionDate + totalMonthsPaid months + 1 day
        // e.g. admitted May 12, paid 1 month → paid through Jun 12 → due Jun 13
        const admDate = student.admissionDate ? new Date(student.admissionDate) : now;
        const paidThroughDate = new Date(admDate);
        paidThroughDate.setMonth(paidThroughDate.getMonth() + totalMonthsPaid);
        const dueDate = new Date(paidThroughDate);
        dueDate.setDate(dueDate.getDate() + 1);

        const daysUntilDue = Math.ceil((dueDate - now) / 86400000);
        const hasDues = dueDate <= now;
        const dueSoon = !hasDues && daysUntilDue <= 7;

        const lastPayment = allPayments.sort((a, b) => new Date(b.receivedDate) - new Date(a.receivedDate))[0];

        return {
          ...student,
          totalMonthsPaid,
          paidThroughDate,
          dueDate,
          daysUntilDue,
          hasDues,
          dueSoon,
          lastPaymentDate: lastPayment?.receivedDate || null,
          lastPaymentAmount: lastPayment?.amount || null,
        };
      })
    );

    const filtered = req.query.all === 'true'
      ? enriched
      : enriched.filter(s => s.hasDues || s.dueSoon);

    filtered.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

    const start = (page - 1) * limit;
    const paginated = filtered.slice(start, start + limit);

    res.json({
      students: paginated,
      pagination: { page, limit, total: filtered.length, pages: Math.ceil(filtered.length / limit) },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.paymentComparison = async (req, res) => {
  try {
    const now = new Date();
    const currentDay = now.getDate();
    const half = currentDay <= 15 ? 1 : 2;

    let current, previous;

    if (half === 1) {
      current = {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth(), 15, 23, 59, 59),
        label: `1-15 ${now.toLocaleString('default', { month: 'short' })}`,
      };
      previous = {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth() - 1, 15, 23, 59, 59),
        label: `1-15 ${new Date(now.getFullYear(), now.getMonth() - 1).toLocaleString('default', { month: 'short' })}`,
      };
    } else {
      const lastCurrent = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const lastPrev = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      current = {
        start: new Date(now.getFullYear(), now.getMonth(), 16),
        end: new Date(now.getFullYear(), now.getMonth(), lastCurrent, 23, 59, 59),
        label: `16-${lastCurrent} ${now.toLocaleString('default', { month: 'short' })}`,
      };
      previous = {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 16),
        end: new Date(now.getFullYear(), now.getMonth() - 1, lastPrev, 23, 59, 59),
        label: `16-${lastPrev} ${new Date(now.getFullYear(), now.getMonth() - 1).toLocaleString('default', { month: 'short' })}`,
      };
    }

    const [currentPayments, previousPayments] = await Promise.all([
      Payment.find({ receivedDate: { $gte: current.start, $lte: current.end } }),
      Payment.find({ receivedDate: { $gte: previous.start, $lte: previous.end } }),
    ]);

    const currentTotal = currentPayments.reduce((s, p) => s + p.amount, 0);
    const previousTotal = previousPayments.reduce((s, p) => s + p.amount, 0);
    const delta = currentTotal - previousTotal;
    const deltaPercent = previousTotal > 0 ? +((delta / previousTotal) * 100).toFixed(1) : (currentTotal > 0 ? 100 : 0);

    res.json({
      current: { ...current, total: currentTotal, count: currentPayments.length },
      previous: { ...previous, total: previousTotal, count: previousPayments.length },
      delta,
      deltaPercent,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
