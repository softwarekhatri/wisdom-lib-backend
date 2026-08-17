const ExcelJS = require("exceljs");
const User = require("../models/User");
const Payment = require("../models/Payment");
const { uploadPhoto } = require("../utils/uploadPhoto");
const { BATCHES } = require("../utils/batches");

function buildPhotoName(fullName, seatAssignments, mobile) {
  const shifts = (seatAssignments || [])
    .map(a => a.batch.replace(/\s+/g, '').replace(/-/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''))
    .join('_');
  return [fullName, shifts, mobile].filter(Boolean).join('_');
}

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
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try {
      list = JSON.parse(raw);
    } catch {
      throw new Error("Invalid seat assignments format");
    }
  }
  if (!Array.isArray(list)) throw new Error("Invalid seat assignments format");

  const cleaned = list
    .map((a) => ({
      batch: (a?.batch || "").trim(),
      seatNumber: (a?.seatNumber || "").trim(),
      remarks: (a?.remarks || "").trim(),
    }))
    // Batch is mandatory; seat number is optional (student may not have a seat yet).
    .filter((a) => a.batch);

  const seenBatches = new Set();
  for (const a of cleaned) {
    if (seenBatches.has(a.batch)) {
      throw new Error(
        `Only one seat can be assigned per batch — duplicate entry for "${a.batch}"`,
      );
    }
    seenBatches.add(a.batch);
  }

  return cleaned;
}

// Checks every (batch, seatNumber) pair against other active students and
// returns the first conflict found, or null. Assignments without a seat
// number can't conflict, since no seat is actually occupied.
async function findSeatConflicts(assignments, excludeId) {
  for (const { batch, seatNumber } of assignments) {
    if (!seatNumber) continue;
    const query = {
      role: "STUDENT",
      isActive: true,
      seatAssignments: { $elemMatch: { batch, seatNumber } },
    };
    if (excludeId) query._id = { $ne: excludeId };
    const conflict = await User.findOne(query).select("fullName");
    if (conflict) {
      return `Seat ${seatNumber} is already occupied for batch ${batch} by ${conflict.fullName}`;
    }
  }
  return null;
}

exports.listStudents = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const skip = (page - 1) * limit;
    const search = (req.query.search || "").trim();

    const filter = { role: "STUDENT" };
    const conditions = [];

    if (req.query.status === "pending") {
      filter.selfAdmission = true;
      filter.verifiedByAdmin = false;
    } else {
      // Exclude unverified self-admissions from regular views
      conditions.push({
        $or: [{ selfAdmission: { $ne: true } }, { verifiedByAdmin: true }],
      });
      if (req.query.active !== undefined)
        filter.isActive = req.query.active === "true";
      if (req.query.flexi === "true") {
        // Flexi: has at least one batch with no seat assigned
        conditions.push({ seatAssignments: { $elemMatch: { batch: { $exists: true, $ne: "" }, seatNumber: "" } } });
      }
    }

    if (search) {
      conditions.push({
        $or: [
          { fullName: { $regex: search, $options: "i" } },
          { mobile: { $regex: search, $options: "i" } },
        ],
      });
    }
    if (conditions.length) filter.$and = conditions;

    const sortOrder = req.query.status === "pending" ? { createdAt: 1 } : { createdAt: -1 };

    const [students, total] = await Promise.all([
      User.find(filter)
        .select("-password")
        .sort(sortOrder)
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    // Single aggregate to get totalMonthsPaid per student (avoids N+1)
    const ids = students.map((s) => s._id);
    const paymentCounts = await Payment.aggregate([
      { $match: { student: { $in: ids } } },
      { $unwind: "$monthsCovered" },
      { $group: { _id: "$student", totalMonths: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(
      paymentCounts.map((p) => [p._id.toString(), p.totalMonths]),
    );

    const enriched = students.map((s) => ({
      ...s,
      nextDueDate: computeNextDueDate(
        s.admissionDate,
        countMap[s._id.toString()] || 0,
      ),
    }));

    res.json({
      students: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.id).select("-password");
    if (!student || student.role !== "STUDENT") {
      return res.status(404).json({ message: "Student not found" });
    }

    // Students can only view themselves
    if (
      req.user.role === "STUDENT" &&
      req.user._id.toString() !== req.params.id
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    const payments = await Payment.find({ student: student._id })
      .sort({ receivedDate: -1 })
      .populate("createdBy", "fullName");

    const totalMonthsPaid = payments.reduce(
      (sum, p) => sum + (p.monthsCovered?.length || 0),
      0,
    );
    const nextDueDate = computeNextDueDate(
      student.admissionDate,
      totalMonthsPaid,
    );

    res.json({ student: { ...student.toObject(), nextDueDate }, payments });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createStudent = async (req, res) => {
  try {
    const {
      fullName,
      mobile,
      whatsappNumber,
      email,
      address,
      admissionDate,
      libraryFees,
      password,
      seatAssignments,
    } = req.body;

    if (!fullName)
      return res.status(400).json({ message: "Full name is required" });

    const username = mobile
      ? mobile.trim().toLowerCase()
      : `student_${Date.now()}`;

    const existing = await User.findOne({ username });
    if (existing) {
      return res
        .status(400)
        .json({ message: "A student with this mobile number already exists" });
    }

    let assignments;
    try {
      assignments = parseSeatAssignments(seatAssignments) || [];
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    if (assignments.length === 0) {
      return res.status(400).json({ message: "At least one batch is required" });
    }

    const conflictMessage = await findSeatConflicts(assignments);
    if (conflictMessage)
      return res.status(400).json({ message: conflictMessage });

    const photoUrl = req.file
      ? await uploadPhoto(req.file.buffer, req.file.originalname, buildPhotoName(fullName?.trim(), assignments, mobile?.trim()))
      : undefined;

    const student = await User.create({
      fullName: fullName.trim(),
      username,
      password: password || "123456",
      role: "STUDENT",
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
    const {
      fullName,
      mobile,
      whatsappNumber,
      email,
      address,
      admissionDate,
      libraryFees,
      isActive,
      seatAssignments,
    } = req.body;

    const existing = await User.findById(req.params.id);
    if (!existing || existing.role !== "STUDENT") {
      return res.status(404).json({ message: "Student not found" });
    }

    const update = {};
    if (fullName !== undefined) update.fullName = fullName.trim();
    if (email !== undefined) update.email = email.trim() || undefined;
    if (address !== undefined) update.address = address.trim() || undefined;
    if (admissionDate !== undefined)
      update.admissionDate = new Date(admissionDate);
    if (libraryFees !== undefined) update.libraryFees = parseFloat(libraryFees);
    if (isActive !== undefined)
      update.isActive = isActive === true || isActive === "true";
    if (whatsappNumber !== undefined)
      update.whatsappNumber = whatsappNumber.trim() || undefined;
    if (req.file) {
      const name    = (fullName || existing.fullName)?.trim();
      const mob     = (mobile   || existing.mobile)?.trim();
      const seats   = update.seatAssignments || existing.seatAssignments;
      update.photo  = await uploadPhoto(req.file.buffer, req.file.originalname, buildPhotoName(name, seats, mob));
    }

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
      if (assignments.length === 0) {
        return res.status(400).json({ message: "At least one batch is required" });
      }
      const conflictMessage = await findSeatConflicts(
        assignments,
        req.params.id,
      );
      if (conflictMessage)
        return res.status(400).json({ message: conflictMessage });
      update.seatAssignments = assignments;
    }

    const student = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
      select: "-password",
    });

    res.json({ student });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.id);
    if (!student || student.role !== "STUDENT") {
      return res.status(404).json({ message: "Student not found" });
    }
    await Payment.deleteMany({ student: student._id });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Student and all associated records deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password)
      return res.status(400).json({ message: "New password is required" });

    await User.findByIdAndUpdate(req.params.id, { password });
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getBatches = (req, res) => {
  res.json({ batches: BATCHES });
};

// Flattened, searchable view of every batch assignment (seat number
// optional) — used by the admin "seat map" screen. Searching by batch shows
// every student in that batch, seated or not; searching by seat number only
// returns students who actually hold that seat.
exports.getSeatMap = async (req, res) => {
  try {
    const batch = (req.query.batch || "").trim();
    const seatNumber = (req.query.seatNumber || "").trim();

    const pipeline = [
      {
        $match: {
          role: "STUDENT",
          isActive: true,
          "seatAssignments.0": { $exists: true },
        },
      },
      { $unwind: "$seatAssignments" },
    ];

    const unwoundMatch = {};
    if (batch)
      unwoundMatch["seatAssignments.batch"] = { $regex: batch, $options: "i" };
    if (seatNumber)
      unwoundMatch["seatAssignments.seatNumber"] = {
        $regex: seatNumber,
        $options: "i",
      };
    if (Object.keys(unwoundMatch).length)
      pipeline.push({ $match: unwoundMatch });

    pipeline.push(
      {
        $project: {
          _id: 0,
          studentId: "$_id",
          fullName: 1,
          mobile: 1,
          username: 1,
          admissionDate: 1,
          batch: "$seatAssignments.batch",
          seatNumber: "$seatAssignments.seatNumber",
        },
      },
      { $sort: { batch: 1, seatNumber: 1 } },
    );

    const seats = await User.aggregate(pipeline);

    // Attach nextDueDate — fetch total months paid per student
    const studentIds = [...new Set(seats.map((s) => s.studentId.toString()))];
    const paymentCounts = await Payment.aggregate([
      { $match: { student: { $in: studentIds.map((id) => require("mongoose").Types.ObjectId.createFromHexString(id)) } } },
      { $unwind: "$monthsCovered" },
      { $group: { _id: "$student", totalMonths: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(
      paymentCounts.map((p) => [p._id.toString(), p.totalMonths]),
    );

    const seatsWithDue = seats.map((s) => {
      const totalMonths = countMap[s.studentId.toString()] || 0;
      const nextDueDate = computeNextDueDate(s.admissionDate, totalMonths);
      return { ...s, nextDueDate };
    });

    res.json({ seats: seatsWithDue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.exportStudentsExcel = async (req, res) => {
  try {
    const students = await User.find({ role: "STUDENT" })
      .sort({ createdAt: -1 })
      .lean();
    const ids = students.map((s) => s._id);

    const payments = await Payment.find({ student: { $in: ids } })
      .sort({ receivedDate: 1 })
      .lean();

    // Build per-student aggregates
    const paymentsByStudent = {};
    for (const p of payments) {
      const key = p.student.toString();
      if (!paymentsByStudent[key]) paymentsByStudent[key] = [];
      paymentsByStudent[key].push(p);
    }

    const totalMonthsMap = {};
    const totalAmountMap = {};
    for (const [key, ps] of Object.entries(paymentsByStudent)) {
      totalMonthsMap[key] = ps.reduce((sum, p) => sum + (p.monthsCovered?.length || 0), 0);
      totalAmountMap[key] = ps.reduce((sum, p) => sum + (p.amount || 0), 0);
    }

    const studentMap = Object.fromEntries(students.map((s) => [s._id.toString(), s]));

    const workbook = new ExcelJS.Workbook();

    // ── Sheet 1: Students ──
    const sheet1 = workbook.addWorksheet("Students");
    sheet1.columns = [
      { header: "Full Name", key: "fullName", width: 24 },
      { header: "Username", key: "username", width: 20 },
      { header: "Mobile", key: "mobile", width: 16 },
      { header: "WhatsApp", key: "whatsappNumber", width: 16 },
      { header: "Email", key: "email", width: 24 },
      { header: "Address", key: "address", width: 30 },
      { header: "Admission Date", key: "admissionDate", width: 16 },
      { header: "Monthly Fees (₹)", key: "libraryFees", width: 16 },
      { header: "Seats (Batch: Seat)", key: "seats", width: 40 },
      { header: "Next Due Date", key: "nextDueDate", width: 16 },
      { header: "Active", key: "isActive", width: 10 },
      { header: "Total Months Paid", key: "totalMonths", width: 18 },
      { header: "Total Amount Paid (₹)", key: "totalAmount", width: 20 },
    ];
    sheet1.getRow(1).font = { bold: true };

    students.forEach((s) => {
      const sid = s._id.toString();
      const totalMonths = totalMonthsMap[sid] || 0;
      const nextDueDate = computeNextDueDate(s.admissionDate, totalMonths);
      const seats = (s.seatAssignments || [])
        .map((a) => (a.seatNumber ? `${a.batch}: Seat ${a.seatNumber}` : a.batch))
        .join("; ");
      sheet1.addRow({
        fullName: s.fullName,
        username: s.username,
        mobile: s.mobile || "",
        whatsappNumber: s.whatsappNumber || "",
        email: s.email || "",
        address: s.address || "",
        admissionDate: s.admissionDate
          ? new Date(s.admissionDate).toLocaleDateString("en-IN")
          : "",
        libraryFees: s.libraryFees || 0,
        seats: seats || "Not decided",
        nextDueDate: nextDueDate ? nextDueDate.toLocaleDateString("en-IN") : "",
        isActive: s.isActive ? "Active" : "Inactive",
        totalMonths,
        totalAmount: totalAmountMap[sid] || 0,
      });
    });

    // ── Sheet 2: Payment History ──
    const sheet2 = workbook.addWorksheet("Payment History");
    sheet2.columns = [
      { header: "Student Name", key: "studentName", width: 24 },
      { header: "Mobile", key: "mobile", width: 16 },
      { header: "Payment Date", key: "receivedDate", width: 16 },
      { header: "Amount (₹)", key: "amount", width: 14 },
      { header: "Mode", key: "mode", width: 12 },
      { header: "Reference No", key: "referenceNo", width: 20 },
      { header: "Months Covered", key: "monthsCovered", width: 40 },
      { header: "Notes", key: "notes", width: 30 },
    ];
    sheet2.getRow(1).font = { bold: true };

    const MONTH_NAMES = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];

    for (const p of payments) {
      const s = studentMap[p.student.toString()];
      const monthsStr = (p.monthsCovered || [])
        .map((m) => `${MONTH_NAMES[m.month - 1]} ${m.year}`)
        .join(", ");
      sheet2.addRow({
        studentName: s?.fullName || "",
        mobile: s?.mobile || "",
        receivedDate: p.receivedDate
          ? new Date(p.receivedDate).toLocaleDateString("en-IN")
          : "",
        amount: p.amount || 0,
        mode: p.mode || "",
        referenceNo: p.referenceNo || "",
        monthsCovered: monthsStr,
        notes: p.notes || "",
      });
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="students.xlsx"',
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Public self-admission (no auth) ───────────────────────────────────────
const BLOCKED_SEAT_NUMS = ["48", "51"];

exports.getPublicSeats = async (req, res) => {
  try {
    const students = await User.find({
      role: "STUDENT",
      isActive: true,
    })
      .select("seatAssignments")
      .lean();

    const bookedMap = {};
    for (const s of students) {
      for (const a of s.seatAssignments || []) {
        if (!a.seatNumber) continue;
        if (!bookedMap[a.batch]) bookedMap[a.batch] = [];
        bookedMap[a.batch].push(String(a.seatNumber));
      }
    }

    res.json({ bookedSeats: bookedMap, blockedSeats: BLOCKED_SEAT_NUMS });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.selfAdmit = async (req, res) => {
  try {
    const { fullName, mobile, whatsappNumber, address } = req.body;

    // Accept assignments as JSON string (multipart) or fallback to legacy batch/seatNumber
    let assignments;
    if (req.body.assignments) {
      try {
        assignments = parseSeatAssignments(req.body.assignments);
      } catch (e) {
        return res.status(400).json({ message: e.message });
      }
    } else if (req.body.batch) {
      assignments = [{ batch: req.body.batch.trim(), seatNumber: (req.body.seatNumber || "").trim() }];
    }

    if (!fullName || !mobile || !assignments || assignments.length === 0) {
      return res.status(400).json({ message: "Name, mobile and at least one batch are required" });
    }

    // Check for duplicate mobile number
    const existing = await User.findOne({ mobile: mobile.trim(), role: "STUDENT" }).select("_id");
    if (existing) {
      return res.status(409).json({
        message: "This mobile number is already registered. / यह मोबाइल नंबर पहले से रजिस्टर है।",
      });
    }

    // Check blocked seats and conflicts for each assignment
    for (const { batch, seatNumber } of assignments) {
      if (seatNumber && BLOCKED_SEAT_NUMS.includes(String(seatNumber))) {
        return res.status(400).json({ message: `Seat ${seatNumber} is not available` });
      }
      if (seatNumber) {
        const conflict = await User.findOne({
          role: "STUDENT",
          isActive: true,
          seatAssignments: { $elemMatch: { batch, seatNumber: String(seatNumber) } },
        }).select("fullName");
        if (conflict) {
          return res.status(409).json({ message: `Seat ${seatNumber} is already taken for ${batch}` });
        }
      }
    }

    // Generate a unique username from mobile
    const baseUsername = mobile.trim().replace(/\D/g, "");
    let username = baseUsername;
    let suffix = 1;
    while (await User.findOne({ username })) {
      username = `${baseUsername}_${suffix++}`;
    }

    let photo;
    if (req.file) {
      photo = await uploadPhoto(
        req.file.buffer,
        req.file.originalname,
        buildPhotoName(fullName.trim(), assignments, mobile.trim()),
      );
    }

    const student = await User.create({
      fullName: fullName.trim(),
      mobile: mobile.trim(),
      whatsappNumber: (whatsappNumber || mobile).trim(),
      address: address || "",
      username,
      password: '123456',
      role: "STUDENT",
      isActive: false,
      selfAdmission: true,
      verifiedByAdmin: false,
      photo,
      seatAssignments: assignments,
      libraryFees: [0, 300, 500, 750, 1000][Math.min(assignments.length, 4)],
    });

    res.status(201).json({ message: "Admission request submitted", studentId: student._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.bulkApproveAdmissions = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: "No IDs provided" });

    const results = { approved: [], failed: [] };
    for (const id of ids) {
      try {
        const student = await User.findOne({ _id: id, role: "STUDENT", selfAdmission: true, verifiedByAdmin: false });
        if (!student) { results.failed.push(id); continue; }
        const conflict = await findSeatConflicts(student.seatAssignments, student._id);
        if (conflict) { results.failed.push(id); continue; }
        student.isActive = true;
        student.verifiedByAdmin = true;
        await student.save();
        results.approved.push(id);
      } catch { results.failed.push(id); }
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.bulkDenyAdmissions = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: "No IDs provided" });

    await User.deleteMany({ _id: { $in: ids }, role: "STUDENT", selfAdmission: true, verifiedByAdmin: false });
    res.json({ message: "Denied and removed" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.approveAdmission = async (req, res) => {
  try {
    const student = await User.findOne({
      _id: req.params.id,
      role: "STUDENT",
      selfAdmission: true,
      verifiedByAdmin: false,
    });
    if (!student)
      return res.status(404).json({ message: "Admission request not found" });

    // Final seat conflict check before activating
    const conflict = await findSeatConflicts(student.seatAssignments, student._id);
    if (conflict) return res.status(409).json({ message: conflict });

    student.isActive = true;
    student.verifiedByAdmin = true;
    await student.save();

    res.json({ message: "Admission approved" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.denyAdmission = async (req, res) => {
  try {
    const student = await User.findOne({
      _id: req.params.id,
      role: "STUDENT",
      selfAdmission: true,
      verifiedByAdmin: false,
    });
    if (!student)
      return res.status(404).json({ message: "Admission request not found" });

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Admission request denied and removed" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
