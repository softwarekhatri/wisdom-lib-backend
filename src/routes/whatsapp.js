const router = require('express').Router();
const { auth, requireRole } = require('../middleware/auth');
const { sendMessage } = require('../controllers/whatsappController');

router.post('/send', auth, requireRole('ADMIN', 'SUPER_ADMIN'), sendMessage);

module.exports = router;
