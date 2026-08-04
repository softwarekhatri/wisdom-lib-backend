const Expense = require('../models/Expense');
const Payment = require('../models/Payment');

exports.addExpense = async (req, res) => {
  try {
    const { amount, date, mode, remarks } = req.body;
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ message: 'amount must be greater than 0' });
    if (!date) return res.status(400).json({ message: 'date is required' });

    const expense = await Expense.create({
      amount: parseFloat(amount),
      date: new Date(date),
      mode: mode || 'cash',
      remarks: remarks?.trim() || undefined,
      createdBy: req.user._id,
    });
    await expense.populate('createdBy', 'fullName');
    res.status(201).json({ expense });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getExpenses = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const skip = (page - 1) * limit;

    const query = {};
    if (req.query.startDate || req.query.endDate) {
      query.date = {};
      if (req.query.startDate) query.date.$gte = new Date(req.query.startDate);
      if (req.query.endDate) {
        const end = new Date(req.query.endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const [expenses, total] = await Promise.all([
      Expense.find(query).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).populate('createdBy', 'fullName'),
      Expense.countDocuments(query),
    ]);

    const totalAmount = expenses.reduce((s, e) => s + e.amount, 0);
    res.json({ expenses, pagination: { page, limit, total, pages: Math.ceil(total / limit) }, totalAmount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.financialsReport = async (req, res) => {
  try {
    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const start = req.query.startDate ? new Date(req.query.startDate) : defaultStart;
    const end = req.query.endDate
      ? (() => { const d = new Date(req.query.endDate); d.setHours(23, 59, 59, 999); return d; })()
      : defaultEnd;

    const [payments, expenses] = await Promise.all([
      Payment.find({ receivedDate: { $gte: start, $lte: end } })
        .populate('student', 'fullName mobile')
        .sort({ receivedDate: -1 }),
      Expense.find({ date: { $gte: start, $lte: end } })
        .populate('createdBy', 'fullName')
        .sort({ date: -1 }),
    ]);

    const totalEarnings = payments.reduce((s, p) => s + p.amount, 0);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const netProfit = totalEarnings - totalExpenses;

    // ── Monthly grouping ───────────────────────────────────────────
    const monthMap = {};

    const monthKey = (d) => {
      const date = new Date(d);
      const mon = date.toLocaleString('default', { month: 'short' });
      return `${mon} ${date.getFullYear()}`;
    };
    // For sorting, derive a sortable YYYY-MM string
    const monthSort = (d) => {
      const date = new Date(d);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    };

    for (const p of payments) {
      const k = monthKey(p.receivedDate);
      if (!monthMap[k]) monthMap[k] = { month: k, _sort: monthSort(p.receivedDate), earnings: 0, expenses: 0, profit: 0 };
      monthMap[k].earnings += p.amount;
    }
    for (const e of expenses) {
      const k = monthKey(e.date);
      if (!monthMap[k]) monthMap[k] = { month: k, _sort: monthSort(e.date), earnings: 0, expenses: 0, profit: 0 };
      monthMap[k].expenses += e.amount;
    }

    const monthlyData = Object.values(monthMap)
      .sort((a, b) => a._sort.localeCompare(b._sort))
      .map(({ _sort, ...rest }) => ({ ...rest, profit: rest.earnings - rest.expenses }));

    // ── Daily grouping ─────────────────────────────────────────────
    const dayMap = {};

    const dayKey = (d) => {
      const date = new Date(d);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    for (const p of payments) {
      const k = dayKey(p.receivedDate);
      if (!dayMap[k]) dayMap[k] = { date: k, earnings: 0, expenses: 0 };
      dayMap[k].earnings += p.amount;
    }
    for (const e of expenses) {
      const k = dayKey(e.date);
      if (!dayMap[k]) dayMap[k] = { date: k, earnings: 0, expenses: 0 };
      dayMap[k].expenses += e.amount;
    }

    const dailyData = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      summary: { totalEarnings, totalExpenses, netProfit },
      monthlyData,
      dailyData,
      expenses,
      payments,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
