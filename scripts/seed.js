require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);

  const existing = await User.findOne({ username: 'admin@wisdomlibrary.in' });
  if (existing) {
    console.log('Admin already exists. Username: admin@wisdomlibrary.in | Password: admin123');
    await mongoose.disconnect();
    return;
  }

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
  await mongoose.disconnect();
}

seed().catch(console.error);
