const router = require('express').Router();
const { auth, requireRole } = require('../middleware/auth');
const { paymentReport, studentsWithDues, paymentComparison } = require('../controllers/reportController');

router.get('/payments', auth, requireRole('ADMIN', 'SUPER_ADMIN'), paymentReport);
router.get('/dues', auth, requireRole('ADMIN', 'SUPER_ADMIN'), studentsWithDues);
router.get('/comparison', auth, requireRole('ADMIN', 'SUPER_ADMIN'), paymentComparison);

module.exports = router;
