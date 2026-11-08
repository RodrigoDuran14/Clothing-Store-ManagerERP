const express = require('express');
const returnController = require('../controllers/returnController');
const { protect } = require('../middleware/auth');
const { isAdmin, isEmployeeOrAbove } = require('../middleware/role');
const validate = require('../middleware/validate');
const {
  createReturnValidator,
  approveReturnValidator,
  rejectReturnValidator,
  cancelReturnValidator,
  processReturnValidator,
  returnIdParamValidator,
  returnNumberParamValidator,
  clientIdParamValidator,
  statsQueryValidator,
} = require('../validators/returnValidator');

const router = express.Router();

router.use(protect, isEmployeeOrAbove);

/* =========================================================
 *  Rutas específicas primero
 * ========================================================= */
router.get('/stats', isAdmin, statsQueryValidator, validate, returnController.getReturnStats);

router.get(
  '/by-number/:returnNumber',
  returnNumberParamValidator,
  validate,
  returnController.getReturnByNumber
);

router.get(
  '/by-client/:clientId',
  clientIdParamValidator,
  validate,
  returnController.getReturnsByClient
);

/* =========================================================
 *  CRUD principal
 * ========================================================= */
router
  .route('/')
  .get(returnController.getReturns)
  .post(createReturnValidator, validate, returnController.createReturn);

/* =========================================================
 *  Flujo de aprobación
 * ========================================================= */
router.patch(
  '/:id/approve',
  isAdmin,
  returnIdParamValidator,
  approveReturnValidator,
  validate,
  returnController.approveReturn
);

router.patch(
  '/:id/reject',
  isAdmin,
  returnIdParamValidator,
  rejectReturnValidator,
  validate,
  returnController.rejectReturn
);

router.patch(
  '/:id/cancel',
  isAdmin,
  returnIdParamValidator,
  cancelReturnValidator,
  validate,
  returnController.cancelReturn
);

/* =========================================================
 *  Procesamiento (restaura stock, ajusta splits, etc.)
 * ========================================================= */
router.post(
  '/:id/process',
  isAdmin,
  returnIdParamValidator,
  processReturnValidator,
  validate,
  returnController.processReturn
);

/* =========================================================
 *  Detalle
 * ========================================================= */
router.get(
  '/:id',
  returnIdParamValidator,
  validate,
  returnController.getReturnById
);

module.exports = router;