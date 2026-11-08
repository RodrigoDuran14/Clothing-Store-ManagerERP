const express = require('express');
const saleController = require('../controllers/saleController');
const { protect } = require('../middleware/auth');
const { isAdmin, isEmployeeOrAbove } = require('../middleware/role');
const validate = require('../middleware/validate');
const {
  createSaleValidator,
  addPaymentValidator,
  cancelSaleValidator,
  saleIdParamValidator,
  saleNumberParamValidator,
  statsQueryValidator,
  topProductsQueryValidator,
} = require('../validators/saleValidator');

const router = express.Router();

router.use(protect, isEmployeeOrAbove);

/* =========================================================
 *  Rutas específicas primero
 * ========================================================= */
router.get('/stats', isAdmin, saleController.getSaleStats);

router.get(
  '/summary',
  isAdmin,
  statsQueryValidator,
  validate,
  saleController.getSalesSummary
);

router.get(
  '/top-products',
  topProductsQueryValidator,
  validate,
  saleController.getTopProducts
);

router.get(
  '/by-number/:saleNumber',
  saleNumberParamValidator,
  validate,
  saleController.getSaleByNumber
);

/* =========================================================
 *  CRUD principal
 * ========================================================= */
router
  .route('/')
  .get(saleController.getSales)
  .post(createSaleValidator, validate, saleController.createSale);

/* =========================================================
 *  Operaciones por id
 * ========================================================= */
router.post(
  '/:id/payments',
  saleIdParamValidator,
  addPaymentValidator,
  validate,
  saleController.addPayment
);

router.post(
  '/:id/cancel',
  isAdmin,
  saleIdParamValidator,
  cancelSaleValidator,
  validate,
  saleController.cancelSale
);

router.get(
  '/:id',
  saleIdParamValidator,
  validate,
  saleController.getSaleById
);

module.exports = router;