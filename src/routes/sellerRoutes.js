const express = require('express');
const sellerController = require('../controllers/sellerController');
const { protect } = require('../middleware/auth');
const { isAdmin, isEmployeeOrAbove } = require('../middleware/role');
const validate = require('../middleware/validate');
const {
  createSellerValidator,
  updateSellerValidator,
  addShiftValidator,
  updateShiftValidator,
  updateCommissionValidator,
  recordSaleValidator,
  commissionPaymentValidator,
  sellerIdParamValidator,
  shiftIdParamValidator,
  periodQueryValidator,
  commissionReportValidator,
} = require('../validators/sellerValidator');

const router = express.Router();

router.use(protect, isEmployeeOrAbove);

/* =========================================================
 *  Rutas específicas primero
 * ========================================================= */
router.get('/top', sellerController.getTopSellers);

router.get('/stats', isAdmin, sellerController.getSellerStats);

router.get(
  '/commission-report',
  isAdmin,
  commissionReportValidator,
  validate,
  sellerController.getCommissionReport
);

/* =========================================================
 *  CRUD principal (admin)
 * ========================================================= */
router.get('/', sellerController.getSellers);

router.post(
  '/',
  isAdmin,
  createSellerValidator,
  validate,
  sellerController.createSeller
);

/* =========================================================
 *  Turnos
 * ========================================================= */
router.post(
  '/:id/shifts',
  isAdmin,
  sellerIdParamValidator,
  addShiftValidator,
  validate,
  sellerController.addShift
);

router.patch(
  '/:id/shifts/:shiftId',
  isAdmin,
  shiftIdParamValidator,
  updateShiftValidator,
  validate,
  sellerController.updateShift
);

router.patch(
  '/:id/shifts/:shiftId/toggle',
  isAdmin,
  shiftIdParamValidator,
  validate,
  sellerController.toggleShift
);

/* =========================================================
 *  Comisiones
 * ========================================================= */
router.patch(
  '/:id/commission',
  isAdmin,
  sellerIdParamValidator,
  updateCommissionValidator,
  validate,
  sellerController.updateCommissionConfig
);

router.get(
  '/:id/commission/summary',
  sellerIdParamValidator,
  periodQueryValidator,
  validate,
  sellerController.getCommissionSummary
);

router.post(
  '/:id/commission/payments',
  isAdmin,
  sellerIdParamValidator,
  commissionPaymentValidator,
  validate,
  sellerController.registerCommissionPayment
);

/* =========================================================
 *  Ventas (registro interno)
 * ========================================================= */
router.post(
  '/:id/sales',
  sellerIdParamValidator,
  recordSaleValidator,
  validate,
  sellerController.recordSale
);

/* =========================================================
 *  Status y perfil (al final)
 * ========================================================= */
router.patch(
  '/:id/status',
  isAdmin,
  sellerIdParamValidator,
  validate,
  sellerController.toggleSellerStatus
);

router
  .route('/:id')
  .get(sellerIdParamValidator, validate, sellerController.getSellerById)
  .patch(
    isAdmin,
    sellerIdParamValidator,
    updateSellerValidator,
    validate,
    sellerController.updateSeller
  );

module.exports = router;