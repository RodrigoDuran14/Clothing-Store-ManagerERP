const { body, param, query } = require('express-validator');
const mongoose = require('mongoose');
const {
  PROMOTION_TYPES,
  BENEFIT_TYPES,
  CHANNELS,
  CLIENT_CATEGORIES,
} = require('../models/Promotion');

const paramObjectId = (field, label) =>
  param(field).custom((v) => {
    if (!mongoose.Types.ObjectId.isValid(v)) {
      throw new Error(`${label} inválido`);
    }
    return true;
  });

const optionalObjectIdRule = (field, label) =>
  body(field)
    .optional({ values: 'null' })
    .custom((v) => {
      if (v && !mongoose.Types.ObjectId.isValid(v)) {
        throw new Error(`${label} inválido`);
      }
      return true;
    });

const arrayObjectIdRule = (field, label) => [
  body(field).optional().isArray(),
  body(`${field}.*`).optional().custom((v) => {
    if (!mongoose.Types.ObjectId.isValid(v)) {
      throw new Error(`${label} inválido en ${field}`);
    }
    return true;
  }),
];

/* =========================================================
 *  CREATE
 * ========================================================= */
const createPromotionValidator = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('El nombre es obligatorio')
    .isLength({ min: 2, max: 150 }),
  body('description').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }),

  body('type')
    .notEmpty()
    .withMessage('El tipo es obligatorio')
    .isIn(PROMOTION_TYPES)
    .withMessage(`Tipo inválido. Use: ${PROMOTION_TYPES.join(', ')}`),

  body('code')
    .if((_, { req }) => req.body.type === 'coupon')
    .trim()
    .notEmpty()
    .withMessage('El código es obligatorio para cupones')
    .isLength({ min: 3, max: 30 })
    .matches(/^[A-Z0-9_-]+$/i)
    .withMessage('El código solo admite letras, números, guiones y guiones bajos'),

  body('priority').optional().isInt({ min: 0, max: 1000 }),

  body('benefitType')
    .notEmpty()
    .withMessage('El tipo de beneficio es obligatorio')
    .isIn(BENEFIT_TYPES)
    .withMessage(`Tipo de beneficio inválido. Use: ${BENEFIT_TYPES.join(', ')}`),

  body('benefitValue').optional().isFloat({ min: 0 }),

  body('buyXGetY').optional().isObject(),
  body('buyXGetY.buyQuantity').optional().isInt({ min: 1 }),
  body('buyXGetY.getQuantity').optional().isInt({ min: 1 }),
  body('buyXGetY.discountPercentage').optional().isFloat({ min: 1, max: 100 }),

  body('maxDiscountAmount').optional().isFloat({ min: 0 }),
  body('minPurchaseAmount').optional().isFloat({ min: 0 }),

  body('applicableChannels').optional().isArray(),
  body('applicableChannels.*').optional().isIn(CHANNELS),
  body('applicableClientCategories').optional().isArray(),
  body('applicableClientCategories.*').optional().isIn(CLIENT_CATEGORIES),

  ...arrayObjectIdRule('applicableProducts', 'ID de producto'),
  ...arrayObjectIdRule('applicableCategories', 'ID de categoría'),

  body('applicableSizes').optional().isArray(),
  body('applicableSizes.*').optional().isString().trim(),
  body('applicableColors').optional().isArray(),
  body('applicableColors.*').optional().isString().trim(),

  body('startDate').optional().isISO8601().withMessage('startDate inválida'),
  body('endDate')
    .optional({ values: 'null' })
    .isISO8601()
    .withMessage('endDate inválida')
    .custom((v, { req }) => {
      if (v && req.body.startDate && new Date(v) <= new Date(req.body.startDate)) {
        throw new Error('endDate debe ser posterior a startDate');
      }
      return true;
    }),

  body('isActive').optional().isBoolean(),
  body('usageLimit').optional().isInt({ min: 0 }),
  body('usageLimitPerCustomer').optional().isInt({ min: 0 }),
  body('isStackable').optional().isBoolean(),
  body('isFeatured').optional().isBoolean(),

  // Coherencia de beneficio
  body().custom((_, { req }) => {
    const { benefitType, benefitValue, buyXGetY } = req.body;
    if (benefitType === 'percentage') {
      if (!benefitValue || benefitValue <= 0 || benefitValue > 100) {
        throw new Error('benefitValue debe estar entre 1 y 100 para tipo percentage');
      }
    }
    if (benefitType === 'fixed') {
      if (!benefitValue || benefitValue <= 0) {
        throw new Error('benefitValue debe ser > 0 para tipo fixed');
      }
    }
    if (benefitType === 'buy_x_get_y') {
      if (!buyXGetY || !buyXGetY.buyQuantity || !buyXGetY.getQuantity) {
        throw new Error('buyXGetY requiere buyQuantity y getQuantity');
      }
    }
    return true;
  }),
];

/* =========================================================
 *  UPDATE (perfil only)
 * ========================================================= */
const updatePromotionValidator = [
  body('name').optional().trim().isLength({ min: 2, max: 150 }),
  body('description').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }),
  body('priority').optional().isInt({ min: 0, max: 1000 }),
  body('maxDiscountAmount').optional().isFloat({ min: 0 }),
  body('minPurchaseAmount').optional().isFloat({ min: 0 }),
  body('applicableChannels').optional().isArray(),
  body('applicableChannels.*').optional().isIn(CHANNELS),
  body('applicableClientCategories').optional().isArray(),
  body('applicableClientCategories.*').optional().isIn(CLIENT_CATEGORIES),
  ...arrayObjectIdRule('applicableProducts', 'ID de producto'),
  ...arrayObjectIdRule('applicableCategories', 'ID de categoría'),
  body('applicableSizes').optional().isArray(),
  body('applicableSizes.*').optional().isString().trim(),
  body('applicableColors').optional().isArray(),
  body('applicableColors.*').optional().isString().trim(),
  body('startDate').optional().isISO8601(),
  body('endDate').optional({ values: 'null' }).isISO8601(),
  body('usageLimit').optional().isInt({ min: 0 }),
  body('usageLimitPerCustomer').optional().isInt({ min: 0 }),
  body('isStackable').optional().isBoolean(),
  body('isFeatured').optional().isBoolean(),

  // 🚫 Bloqueo explícito
  body().custom((_, { req }) => {
    const forbidden = [
      'type',
      'code',
      'benefitType',
      'benefitValue',
      'buyXGetY',
      'usageCount',
      'usageByClient',
      'isActive',
    ].filter((f) => req.body[f] !== undefined);
    if (forbidden.length > 0) {
      throw new Error(
        `Los campos '${forbidden.join("', '")}' no se pueden modificar por esta ruta. ` +
          'Use los endpoints específicos (/benefit, /status).'
      );
    }
    return true;
  }),
];

/* =========================================================
 *  UPDATE BENEFIT
 * ========================================================= */
const updateBenefitValidator = [
  body('benefitType')
    .notEmpty()
    .withMessage('El tipo de beneficio es obligatorio')
    .isIn(BENEFIT_TYPES)
    .withMessage(`Tipo inválido. Use: ${BENEFIT_TYPES.join(', ')}`),
  body('benefitValue').optional().isFloat({ min: 0 }),
  body('buyXGetY').optional().isObject(),
  body('buyXGetY.buyQuantity').optional().isInt({ min: 1 }),
  body('buyXGetY.getQuantity').optional().isInt({ min: 1 }),
  body('buyXGetY.discountPercentage').optional().isFloat({ min: 1, max: 100 }),
  body('maxDiscountAmount').optional().isFloat({ min: 0 }),
  body().custom((_, { req }) => {
    const { benefitType, benefitValue, buyXGetY } = req.body;
    if (benefitType === 'percentage' && (!benefitValue || benefitValue <= 0 || benefitValue > 100)) {
      throw new Error('benefitValue debe estar entre 1 y 100 para percentage');
    }
    if (benefitType === 'fixed' && (!benefitValue || benefitValue <= 0)) {
      throw new Error('benefitValue debe ser > 0 para fixed');
    }
    if (benefitType === 'buy_x_get_y' && (!buyXGetY || !buyXGetY.buyQuantity || !buyXGetY.getQuantity)) {
      throw new Error('buyXGetY requiere buyQuantity y getQuantity');
    }
    return true;
  }),
];

/* =========================================================
 *  PREVIEW / VALIDATE-COUPON
 * ========================================================= */
const previewValidator = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('items debe tener al menos un producto'),
  body('items.*.productId')
    .notEmpty()
    .custom((v) => {
      if (!mongoose.Types.ObjectId.isValid(v)) throw new Error('productId inválido');
      return true;
    }),
  body('items.*.quantity').isInt({ min: 1 }),
  body('items.*.unitPrice').optional().isFloat({ min: 0 }),
  body('items.*.size').optional().isString().trim(),
  body('items.*.color').optional().isString().trim(),
  body('subtotal').optional().isFloat({ min: 0 }),
  body('couponCodes').optional().isArray(),
  body('couponCodes.*').optional().isString().trim(),
  optionalObjectIdRule('clientId', 'clientId'),
  body('channel').optional().isIn(CHANNELS),
];

const validateCouponValidator = [
  body('code').trim().notEmpty().withMessage('El código es obligatorio'),
  body('saleTotal').notEmpty().withMessage('saleTotal es obligatorio').isFloat({ min: 0 }),
  optionalObjectIdRule('clientId', 'clientId'),
  body('channel').optional().isIn(CHANNELS),
];

/* =========================================================
 *  Params y Query
 * ========================================================= */
const promotionIdParamValidator = [paramObjectId('id', 'ID de promoción')];
const codeParamValidator = [
  param('code').trim().notEmpty().withMessage('El código es obligatorio'),
];

const listQueryValidator = [
  query('type').optional().isIn(PROMOTION_TYPES),
  query('benefitType').optional().isIn(BENEFIT_TYPES),
  query('isActive').optional().isBoolean(),
  query('featured').optional().isBoolean(),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
];

const productIdParamValidator = [paramObjectId('productId', 'ID de producto')];

module.exports = {
  createPromotionValidator,
  updatePromotionValidator,
  updateBenefitValidator,
  previewValidator,
  validateCouponValidator,
  promotionIdParamValidator,
  codeParamValidator,
  listQueryValidator,
  productIdParamValidator,
};