const cloudinary = require('cloudinary').v2;
// SDK auto-configures from CLOUDINARY_URL env var (cloudinary://key:secret@cloud_name)

const uploadToCloudinary = async (buffer, filename) => {
  const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
  const mime =
    ext === 'png'  ? 'image/png'  :
    ext === 'gif'  ? 'image/gif'  :
    ext === 'webp' ? 'image/webp' : 'image/jpeg';

  const result = await cloudinary.uploader.upload(
    `data:${mime};base64,${buffer.toString('base64')}`,
    { resource_type: 'image' }
  );
  return result.secure_url;
};

module.exports = { uploadToCloudinary };
