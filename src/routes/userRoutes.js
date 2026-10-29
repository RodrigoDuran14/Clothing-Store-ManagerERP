const express = require('express');
const userController = require('../controllers/userController');
const { protect } = require('../middleware/auth');
const { isAdmin } = require('../middleware/role');
const validate = require('../middleware/validate');
const {
  createUserValidator,
  updateUserValidator,
  updateUserRoleValidator,
  userIdParamValidator,
} = require('../validators/userValidator');

const router = express.Router();

// Todas las rutas requieren autenticación + rol admin
router.use(protect, isAdmin);

router.get('/stats', userController.getUserStats);

router
  .route('/')
  .get(userController.getUsers)
  .post(createUserValidator, validate, userController.createUser);

router.patch(
  '/:id/role',
  userIdParamValidator,
  updateUserRoleValidator,
  validate,
  userController.updateUserRole
);
router.patch(
  '/:id/reactivate',
  userIdParamValidator,
  validate,
  userController.reactivateUser
);
router.delete(
  '/:id/permanent',
  userIdParamValidator,
  validate,
  userController.permanentDeleteUser
);

router
  .route('/:id')
  .get(userIdParamValidator, validate, userController.getUserById)
  .patch(userIdParamValidator, updateUserValidator, validate, userController.updateUser)
  .delete(userIdParamValidator, validate, userController.deleteUser);

module.exports = router;