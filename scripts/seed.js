require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);

  const existingAdmin = await User.findOne({ username: 'admin@wisdomlibrary.in' });
  if (existingAdmin) {
    console.log('Admin already exists. Username: admin@wisdomlibrary.in | Password: admin123');
  } else {
    await User.create({
      fullName: 'Library Admin',
      username: 'admin@wisdomlibrary.in',
      email: 'admin@wisdomlibrary.in',
      password: 'admin123',
      role: 'ADMIN',
      libraryFees: 0,
    });
    console.log('✅ Admin created!');
    console.log('Username: admin@wisdomlibrary.in');
    console.log('Password: admin123');
  }

  const existingManager = await User.findOne({ username: 'manager@wisdomlibrary.in' });
  if (existingManager) {
    console.log('Manager already exists. Username: manager@wisdomlibrary.in | Password: manager123');
  } else {
    await User.create({
      fullName: 'Library Manager',
      username: 'manager@wisdomlibrary.in',
      email: 'manager@wisdomlibrary.in',
      password: 'manager123',
      role: 'MANAGER',
      libraryFees: 0,
    });
    console.log('✅ Manager created!');
    console.log('Username: manager@wisdomlibrary.in');
    console.log('Password: manager123');
  }

  await mongoose.disconnect();
}

seed().catch(console.error);
