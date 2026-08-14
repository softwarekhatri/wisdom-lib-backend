const router = require('express').Router();
const multer = require('multer');
const { selfAdmit, getPublicSeats } = require('../controllers/studentController');
const { BATCHES } = require('../utils/batches');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/seats', getPublicSeats);
router.get('/batches', (req, res) => res.json({ batches: BATCHES }));
router.post('/admission', upload.single('photo'), selfAdmit);

module.exports = router;
