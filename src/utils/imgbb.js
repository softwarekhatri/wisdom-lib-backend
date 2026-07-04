const uploadToImgbb = async (buffer, filename) => {
  const form = new FormData();
  form.append('image', new Blob([buffer]), filename);

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, {
    method: 'POST',
    body: form,
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data?.error?.message || 'Image upload failed');
  }

  return data.data.url;
};

module.exports = { uploadToImgbb };
