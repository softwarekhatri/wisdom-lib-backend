const router = require('express').Router();
const { auth, requireRole } = require('../middleware/auth');
const { addPayment, getStudentPayments, getAllPayments, deletePayment } = require('../controllers/paymentController');

router.post('/', auth, requireRole('ADMIN', 'SUPER_ADMIN'), addPayment);
router.get('/', auth, requireRole('ADMIN', 'SUPER_ADMIN'), getAllPayments);
router.get('/student/:studentId', auth, getStudentPayments);
router.delete('/:id', auth, requireRole('ADMIN', 'SUPER_ADMIN'), deletePayment);

module.exports = router;
