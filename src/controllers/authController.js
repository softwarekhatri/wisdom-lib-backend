const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }

    const user = await User.findOne({ username: username.toLowerCase().trim(), isActive: true });
    if (!user || user.password !== password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);

    res.json({
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        username: user.username,
        role: user.role,
        photo: user.photo,
        email: user.email,
        mobile: user.mobile,
        admissionDate: user.admissionDate,
        libraryFees: user.libraryFees,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.me = async (req, res) => {
  const raw = req.user.toObject();
  delete raw.password;
  res.json({
    user: {
      ...raw,
      id: raw._id,   // normalize: match the shape returned by /login
    },
  });
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    if (req.user.password !== currentPassword) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    await User.findByIdAndUpdate(req.user._id, { password: newPassword });
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { fullName, email } = req.body;
    const update = {};
    if (fullName?.trim()) update.fullName = fullName.trim();
    if (email?.trim()) update.email = email.trim().toLowerCase();

    const user = await User.findByIdAndUpdate(req.user._id, update, {
      new: true,
      select: '-password',
    });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
