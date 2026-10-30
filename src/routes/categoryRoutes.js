const express = require('express');
const categoryController = require('../controllers/categoryController');
const { protect } = require('../middleware/auth');
const { isAdmin } = require('../middleware/role');
const validate = require('../middleware/validate');
const {
  createCategoryValidator,
  updateCategoryValidator,
  categoryIdParamValidator,
  reorderCategoriesValidator,
} = require('../validators/categoryValidator');

const router = express.Router();

/* =========================================================
 *  Rutas públicas (solo lectura)
 * ========================================================= */
router.get('/', categoryController.getCategories);

// /stats debe ir ANTES de /:id para no confundirse con un ObjectId
router.get('/stats', protect, isAdmin, categoryController.getCategoryStats);

router.get(
  '/:id/breadcrumb',
  categoryIdParamValidator,
  validate,
  categoryController.getCategoryBreadcrumb
);

router.get(
  '/:id/subcategories',
  categoryIdParamValidator,
  validate,
  categoryController.getSubcategories
);

router.get(
  '/:id',
  categoryIdParamValidator,
  validate,
  categoryController.getCategoryById
);

/* =========================================================
 *  Mutaciones (solo admin)
 * ========================================================= */
router.post(
  '/',
  protect,
  isAdmin,
  createCategoryValidator,
  validate,
  categoryController.createCategory
);

router.patch(
  '/reorder',
  protect,
  isAdmin,
  reorderCategoriesValidator,
  validate,
  categoryController.reorderCategories
);

router.patch(
  '/:id/status',
  protect,
  isAdmin,
  categoryIdParamValidator,
  validate,
  categoryController.toggleCategoryStatus
);

router.patch(
  '/:id',
  protect,
  isAdmin,
  categoryIdParamValidator,
  updateCategoryValidator,
  validate,
  categoryController.updateCategory
);

router.delete(
  '/:id',
  protect,
  isAdmin,
  categoryIdParamValidator,
  validate,
  categoryController.deleteCategory
);

module.exports = router;