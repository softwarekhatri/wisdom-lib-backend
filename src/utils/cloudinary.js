const cloudinary = require('cloudinary').v2;
// SDK auto-configures from CLOUDINARY_URL env var (cloudinary://key:secret@cloud_name)

const sanitizePublicId = (name) =>
  name.trim().replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_');

const uploadToCloudinary = async (buffer, filename, { folder, publicId } = {}) => {
  const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
  const mime =
    ext === 'png'  ? 'image/png'  :
    ext === 'gif'  ? 'image/gif'  :
    ext === 'webp' ? 'image/webp' : 'image/jpeg';

  const opts = { resource_type: 'image', overwrite: true };
  if (folder)   opts.folder    = folder;
  if (publicId) opts.public_id = sanitizePublicId(publicId);

  const result = await cloudinary.uploader.upload(
    `data:${mime};base64,${buffer.toString('base64')}`,
    opts
  );
  return result.secure_url;
};

module.exports = { uploadToCloudinary };
