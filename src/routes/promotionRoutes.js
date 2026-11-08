const express = require('express');
const promotionController = require('../controllers/promotionController');
const { protect } = require('../middleware/auth');
const { isAdmin, isEmployeeOrAbove } = require('../middleware/role');
const validate = require('../middleware/validate');
const {
  createPromotionValidator,
  updatePromotionValidator,
  updateBenefitValidator,
  previewValidator,
  validateCouponValidator,
  promotionIdParamValidator,
  codeParamValidator,
  listQueryValidator,
  productIdParamValidator,
} = require('../validators/promotionValidator');

const router = express.Router();

router.use(protect, isEmployeeOrAbove);

/* =========================================================
 *  Staff endpoints (POS / ecommerce)
 * ========================================================= */
router.get('/active', promotionController.getActivePromotions);
router.get('/featured', promotionController.getFeaturedPromotions);

router.get(
  '/by-code/:code',
  codeParamValidator,
  validate,
  promotionController.getPromotionByCode
);

router.get(
  '/by-product/:productId',
  productIdParamValidator,
  validate,
  promotionController.getPromotionsByProduct
);

router.post(
  '/preview',
  previewValidator,
  validate,
  promotionController.previewPromotions
);

router.post(
  '/validate-coupon',
  validateCouponValidator,
  validate,
  promotionController.validateCoupon
);

/* =========================================================
 *  Admin
 * ========================================================= */
router.get(
  '/stats',
  isAdmin,
  promotionController.getPromotionStats
);

router
  .route('/')
  .get(isAdmin, listQueryValidator, validate, promotionController.getPromotions)
  .post(
    isAdmin,
    createPromotionValidator,
    validate,
    promotionController.createPromotion
  );

router.patch(
  '/:id/benefit',
  isAdmin,
  promotionIdParamValidator,
  updateBenefitValidator,
  validate,
  promotionController.updatePromotionBenefit
);

router.patch(
  '/:id/status',
  isAdmin,
  promotionIdParamValidator,
  validate,
  promotionController.togglePromotionStatus
);

router
  .route('/:id')
  .get(isAdmin, promotionIdParamValidator, validate, promotionController.getPromotionById)
  .patch(
    isAdmin,
    promotionIdParamValidator,
    updatePromotionValidator,
    validate,
    promotionController.updatePromotion
  )
  .delete(
    isAdmin,
    promotionIdParamValidator,
    validate,
    promotionController.deletePromotion
  );

module.exports = router;