const { uploadToCloudinary } = require('./cloudinary');

const uploadPhoto = (buffer, filename) => uploadToCloudinary(buffer, filename);

module.exports = { uploadPhoto };
