const router = require('express').Router();
const multer = require('multer');
const { auth, requireRole } = require('../middleware/auth');
const {
  listStudents,
  getStudent,
  createStudent,
  updateStudent,
  resetPassword,
  deleteStudent,
  getBatches,
  getSeatMap,
  exportStudentsExcel,
} = require('../controllers/studentController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', auth, requireRole('MANAGER', 'ADMIN', 'SUPER_ADMIN'), listStudents);
router.post('/', auth, requireRole('MANAGER', 'ADMIN', 'SUPER_ADMIN'), upload.single('photo'), createStudent);
router.get('/batches', auth, getBatches);
router.get('/seats', auth, requireRole('MANAGER', 'ADMIN', 'SUPER_ADMIN'), getSeatMap);
router.get('/export/excel', auth, requireRole('MANAGER', 'ADMIN', 'SUPER_ADMIN'), exportStudentsExcel);
router.get('/:id', auth, getStudent);
router.put('/:id', auth, requireRole('ADMIN', 'SUPER_ADMIN'), upload.single('photo'), updateStudent);
router.patch('/:id/password', auth, requireRole('ADMIN', 'SUPER_ADMIN'), resetPassword);
router.delete('/:id', auth, requireRole('ADMIN', 'SUPER_ADMIN'), deleteStudent);

module.exports = router;
