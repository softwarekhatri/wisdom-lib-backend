const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { auth, requireRole } = require('../middleware/auth');
const {
  listStudents,
  getStudent,
  createStudent,
  updateStudent,
  resetPassword,
  deleteStudent,
} = require('../controllers/studentController');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `photo_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', auth, requireRole('ADMIN', 'SUPER_ADMIN'), listStudents);
router.post('/', auth, requireRole('ADMIN', 'SUPER_ADMIN'), upload.single('photo'), createStudent);
router.get('/:id', auth, getStudent);
router.put('/:id', auth, requireRole('ADMIN', 'SUPER_ADMIN'), upload.single('photo'), updateStudent);
router.patch('/:id/password', auth, requireRole('ADMIN', 'SUPER_ADMIN'), resetPassword);
router.delete('/:id', auth, requireRole('ADMIN', 'SUPER_ADMIN'), deleteStudent);

module.exports = router;
