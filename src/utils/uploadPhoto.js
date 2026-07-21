const { uploadToCloudinary } = require('./cloudinary');

const FOLDER = 'Wisdom Library';

const uploadPhoto = (buffer, filename, studentName) =>
  uploadToCloudinary(buffer, filename, {
    folder: FOLDER,
    publicId: studentName || undefined,
  });

module.exports = { uploadPhoto };
