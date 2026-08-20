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
  approveAdmission,
  denyAdmission,
  bulkApproveAdmissions,
  bulkDenyAdmissions,
  sendReminder,
} = require('../controllers/studentController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', auth, requireRole('VIEWER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'), listStudents);
router.post('/', auth, requireRole('MANAGER', 'ADMIN', 'SUPER_ADMIN'), upload.single('photo'), createStudent);
router.get('/batches', auth, getBatches);
router.get('/seats', auth, requireRole('VIEWER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'), getSeatMap);
router.get('/export/excel', auth, requireRole('VIEWER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'), exportStudentsExcel);
router.get('/:id', auth, getStudent);
router.put('/:id', auth, requireRole('ADMIN', 'SUPER_ADMIN'), upload.single('photo'), updateStudent);
router.patch('/:id/password', auth, requireRole('ADMIN', 'SUPER_ADMIN'), resetPassword);
router.patch('/:id/remind', auth, requireRole('MANAGER', 'ADMIN', 'SUPER_ADMIN'), sendReminder);
router.delete('/:id', auth, requireRole('ADMIN', 'SUPER_ADMIN'), deleteStudent);
router.patch('/:id/approve-admission', auth, requireRole('MANAGER', 'ADMIN', 'SUPER_ADMIN'), approveAdmission);
router.delete('/:id/deny-admission', auth, requireRole('MANAGER', 'ADMIN', 'SUPER_ADMIN'), denyAdmission);
router.post('/bulk-approve-admissions', auth, requireRole('MANAGER', 'ADMIN', 'SUPER_ADMIN'), bulkApproveAdmissions);
router.post('/bulk-deny-admissions', auth, requireRole('MANAGER', 'ADMIN', 'SUPER_ADMIN'), bulkDenyAdmissions);

module.exports = router;
