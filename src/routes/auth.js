const router = require('express').Router();
const { login, me, changePassword, updateProfile } = require('../controllers/authController');
const { auth } = require('../middleware/auth');

router.post('/login', login);
router.get('/me', auth, me);
router.patch('/change-password', auth, changePassword);
router.patch('/profile', auth, updateProfile);

module.exports = router;
