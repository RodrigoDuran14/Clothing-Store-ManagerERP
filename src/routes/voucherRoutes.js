const express = require('express');
const voucherController = require('../controllers/voucherController');
const { protect } = require('../middleware/auth');
const { isAdmin, isEmployeeOrAbove } = require('../middleware/role');
const validate = require('../middleware/validate');
const {
  createVoucherValidator,
  bulkCreateVoucherValidator,
  validateVoucherValidator,
  cancelVoucherValidator,
  voucherIdParamValidator,
  codeParamValidator,
  clientIdParamValidator,
  listQueryValidator,
} = require('../validators/voucherValidator');

const router = express.Router();

router.use(protect, isEmployeeOrAbove);

/* =========================================================
 *  Staff endpoints (POS necesita consultar)
 * ========================================================= */
router.get(
  '/by-code/:code',
  codeParamValidator,
  validate,
  voucherController.getVoucherByCode
);

router.get(
  '/by-client/:clientId',
  clientIdParamValidator,
  validate,
  voucherController.getVouchersByClient
);

router.post(
  '/validate',
  validateVoucherValidator,
  validate,
  voucherController.validateVouchers
);

/* =========================================================
 *  Admin endpoints
 * ========================================================= */
router.get(
  '/stats',
  isAdmin,
  listQueryValidator,
  validate,
  voucherController.getVoucherStats
);

router.post(
  '/bulk',
  isAdmin,
  bulkCreateVoucherValidator,
  validate,
  voucherController.createBulkVouchers
);

router
  .route('/')
  .get(isAdmin, listQueryValidator, validate, voucherController.getVouchers)
  .post(isAdmin, createVoucherValidator, validate, voucherController.createVoucher);

router.patch(
  '/:id/cancel',
  isAdmin,
  voucherIdParamValidator,
  cancelVoucherValidator,
  validate,
  voucherController.cancelVoucher
);

router.get(
  '/:id',
  isAdmin,
  voucherIdParamValidator,
  validate,
  voucherController.getVoucherById
);

module.exports = router;