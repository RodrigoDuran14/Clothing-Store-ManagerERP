const express = require('express');
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  registerValidator,
  loginValidator,
  updateMeValidator,
  updatePasswordValidator,
} = require('../validators/authValidator');

const router = express.Router();

// Públicas
router.post('/register', registerValidator, validate, authController.register);
router.post('/login', loginValidator, validate, authController.login);

// Protegidas
router.use(protect);
router.get('/me', authController.getMe);
router.patch('/me', updateMeValidator, validate, authController.updateMe);
router.patch(
  '/update-password',
  updatePasswordValidator,
  validate,
  authController.updatePassword
);
router.post('/logout', authController.logout);

module.exports = router;