const router = require('express').Router();
const { auth, requireRole } = require('../middleware/auth');
const { addExpense, getExpenses, deleteExpense } = require('../controllers/expenseController');

router.post('/', auth, requireRole('ADMIN', 'SUPER_ADMIN'), addExpense);
router.get('/', auth, requireRole('MANAGER', 'ADMIN', 'SUPER_ADMIN'), getExpenses);
router.delete('/:id', auth, requireRole('ADMIN', 'SUPER_ADMIN'), deleteExpense);

module.exports = router;
