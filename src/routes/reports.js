const router = require('express').Router();
const { auth, requireRole } = require('../middleware/auth');
const { paymentReport, studentsWithDues, paymentComparison, dashboardStats, shiftDistribution } = require('../controllers/reportController');
const { financialsReport } = require('../controllers/expenseController');

router.get('/dashboard', auth, requireRole('VIEWER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'), dashboardStats);
router.get('/payments', auth, requireRole('VIEWER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'), paymentReport);
router.get('/dues', auth, requireRole('VIEWER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'), studentsWithDues);
router.get('/comparison', auth, requireRole('VIEWER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'), paymentComparison);
router.get('/financials', auth, requireRole('VIEWER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'), financialsReport);
router.get('/shifts', auth, requireRole('VIEWER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'), shiftDistribution);

module.exports = router;
