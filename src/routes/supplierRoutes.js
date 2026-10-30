const express = require('express');
const supplierController = require('../controllers/supplierController');
const { protect } = require('../middleware/auth');
const { isAdmin } = require('../middleware/role');
const validate = require('../middleware/validate');
const {
  createSupplierValidator,
  updateSupplierValidator,
  supplierIdParamValidator,
  recordPurchaseValidator,
  updateDebtValidator,
  addProductValidator,
  productIdParamValidator,
} = require('../validators/supplierValidator');

const router = express.Router();

// Todas las rutas de proveedores son admin-only
router.use(protect, isAdmin);

router.get('/stats', supplierController.getSupplierStats);
router.get('/top', supplierController.getTopSuppliers);
router.get('/financial-summary', supplierController.getFinancialSummary);
router.get(
  '/by-product/:productId',
  productIdParamValidator,
  validate,
  supplierController.getSuppliersByProduct
);

/* =========================================================
 *  CRUD principal
 * ========================================================= */
router
  .route('/')
  .get(supplierController.getSuppliers)
  .post(createSupplierValidator, validate, supplierController.createSupplier);

/* =========================================================
 *  Operaciones sobre un proveedor
 * ========================================================= */
router.patch(
  '/:id/status',
  supplierIdParamValidator,
  validate,
  supplierController.toggleSupplierStatus
);

router.post(
  '/:id/products',
  supplierIdParamValidator,
  addProductValidator,
  validate,
  supplierController.addProductToSupplier
);

router.delete(
  '/:id/products/:productId',
  supplierIdParamValidator,
  productIdParamValidator,
  validate,
  supplierController.removeProductFromSupplier
);

router.post(
  '/:id/purchases',
  supplierIdParamValidator,
  recordPurchaseValidator,
  validate,
  supplierController.recordPurchase
);

router.patch(
  '/:id/debt',
  supplierIdParamValidator,
  updateDebtValidator,
  validate,
  supplierController.updateDebt
);

/* =========================================================
 *  GET / PATCH / DELETE por id
 * ========================================================= */
router
  .route('/:id')
  .get(supplierIdParamValidator, validate, supplierController.getSupplierById)
  .patch(
    supplierIdParamValidator,
    updateSupplierValidator,
    validate,
    supplierController.updateSupplier
  )
  .delete(supplierIdParamValidator, validate, supplierController.deleteSupplier);

module.exports = router;