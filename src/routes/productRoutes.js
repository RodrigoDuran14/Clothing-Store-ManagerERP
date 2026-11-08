const express = require('express');
const productController = require('../controllers/productController');
const { protect, softProtect } = require('../middleware/auth');
const { isAdmin, isEmployeeOrAbove } = require('../middleware/role');
const validate = require('../middleware/validate');
const {
  createProductValidator,
  updateProductValidator,
  updateStockValidator,
  checkStockValidator,
  addImageValidator,
  productIdParamValidator,
  imageIdParamValidator,
  barcodeParamValidator,
} = require('../validators/productValidator');

const router = express.Router();

/* =========================================================
 *  Públicas (softProtect → staff ve más datos)
 * ========================================================= */
router.get('/', softProtect, productController.getProducts);

/* =========================================================
 *  Staff (employee / partner / admin)
 * ========================================================= */
router.get(
  '/by-barcode/:barcode',
  protect,
  isEmployeeOrAbove,
  barcodeParamValidator,
  validate,
  productController.getProductByBarcode
);

router.get(
  '/low-stock',
  protect,
  isEmployeeOrAbove,
  productController.getLowStockProducts
);

/* =========================================================
 *  Admin (stats) — antes de /:id
 * ========================================================= */
router.get(
  '/stats',
  protect,
  isAdmin,
  productController.getProductStats
);

/* =========================================================
 *  Pública (detalle)
 * ========================================================= */
router.get(
  '/:id',
  softProtect,
  productIdParamValidator,
  validate,
  productController.getProductById
);

/* =========================================================
 *  Staff (stock)
 * ========================================================= */
router.get(
  '/:id/stock/check',
  protect,
  isEmployeeOrAbove,
  productIdParamValidator,
  checkStockValidator,
  validate,
  productController.checkStock
);

router.post(
  '/:id/stock',
  protect,
  isEmployeeOrAbove,
  productIdParamValidator,
  updateStockValidator,
  validate,
  productController.updateStock
);

/* =========================================================
 *  Admin (CRUD e imágenes)
 * ========================================================= */
router.post(
  '/',
  protect,
  isAdmin,
  createProductValidator,
  validate,
  productController.createProduct
);

router.patch(
  '/:id/status',
  protect,
  isAdmin,
  productIdParamValidator,
  validate,
  productController.toggleProductStatus
);

router.post(
  '/:id/images',
  protect,
  isAdmin,
  productIdParamValidator,
  addImageValidator,
  validate,
  productController.addProductImage
);

router.delete(
  '/:id/images/:imageId',
  protect,
  isAdmin,
  imageIdParamValidator,
  validate,
  productController.deleteProductImage
);

router.patch(
  '/:id/images/:imageId/main',
  protect,
  isAdmin,
  imageIdParamValidator,
  validate,
  productController.setMainImage
);

router
  .route('/:id')
  .patch(
    protect,
    isAdmin,
    productIdParamValidator,
    updateProductValidator,
    validate,
    productController.updateProduct
  )
  .delete(
    protect,
    isAdmin,
    productIdParamValidator,
    validate,
    productController.deleteProduct
  );

module.exports = router;