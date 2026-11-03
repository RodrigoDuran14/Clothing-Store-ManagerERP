const { body, param, query } = require('express-validator');
const mongoose = require('mongoose');
const {
  VOUCHER_TYPES,
  VOUCHER_STATUSES,
  VOUCHER_CHANNELS,
} = require('../models/Voucher');

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
const createVoucherValidator = [
  body('type')
    .notEmpty()
    .withMessage('El tipo es obligatorio')
    .isIn(VOUCHER_TYPES)
    .withMessage(`Tipo inválido. Use: ${VOUCHER_TYPES.join(', ')}`),

  body('originalAmount')
    .notEmpty()
    .withMessage('El monto es obligatorio')
    .isFloat({ gt: 0 })
    .withMessage('El monto debe ser mayor a cero'),

  body('currency').optional().isString().trim().isLength({ max: 5 }),

  body('minimumPurchase')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('minimumPurchase no puede ser negativo'),

  ...arrayObjectIdRule('applicableCategories', 'ID de categoría'),
  ...arrayObjectIdRule('applicableProducts', 'ID de producto'),

  body('applicableChannels').optional().isArray(),
  body('applicableChannels.*').optional().isIn(VOUCHER_CHANNELS),

  body('isStackable').optional().isBoolean(),
  body('maxUses').optional().isInt({ min: 1, max: 10000 }),

  body('expiresAt')
    .optional({ values: 'null' })
    .isISO8601()
    .withMessage('Fecha de vencimiento inválida')
    .custom((v) => {
      if (v && new Date(v) <= new Date()) {
        throw new Error('La fecha de vencimiento debe ser futura');
      }
      return true;
    }),

  optionalObjectIdRule('clientId', 'clientId'),
  body('issuedTo').optional({ values: 'falsy' }).isString().trim().isLength({ max: 200 }),
  optionalObjectIdRule('returnId', 'returnId'),
  optionalObjectIdRule('issuedSaleId', 'issuedSaleId'),

  body('code')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .toUpperCase()
    .matches(/^[A-Z0-9-]+$/)
    .withMessage('El código solo puede contener letras, números y guiones')
    .isLength({ min: 3, max: 50 }),

  body('notes').optional({ values: 'falsy' }).isString().trim().isLength({ max: 500 }),
];

/* =========================================================
 *  BULK
 * ========================================================= */
const bulkCreateVoucherValidator = [
  body('count')
    .notEmpty()
    .withMessage('count es obligatorio')
    .isInt({ min: 1, max: 500 })
    .withMessage('count debe estar entre 1 y 500'),
  body('template')
    .notEmpty()
    .withMessage('template es obligatorio')
    .isObject()
    .withMessage('template debe ser un objeto'),
  body('template.type')
    .notEmpty()
    .isIn(VOUCHER_TYPES)
    .withMessage(`Tipo inválido. Use: ${VOUCHER_TYPES.join(', ')}`),
  body('template.originalAmount')
    .notEmpty()
    .isFloat({ gt: 0 })
    .withMessage('El monto debe ser mayor a cero'),
  body('template.code')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .toUpperCase()
    .matches(/^[A-Z0-9-]+$/)
    .withMessage('El código solo puede contener letras, números y guiones'),
];

/* =========================================================
 *  VALIDATE (pre-check en POS)
 * ========================================================= */
const validateVoucherValidator = [
  body('codes')
    .isArray({ min: 1 })
    .withMessage('Debe enviar al menos un código'),
  body('codes.*').isString().trim().notEmpty(),
  body('saleTotal')
    .notEmpty()
    .withMessage('saleTotal es obligatorio')
    .isFloat({ min: 0 }),
  body('channel').optional().isIn(VOUCHER_CHANNELS),
  optionalObjectIdRule('clientId', 'clientId'),
  body('productIds').optional().isArray(),
  body('productIds.*').optional().custom((v) => {
    if (!mongoose.Types.ObjectId.isValid(v)) throw new Error('productId inválido');
    return true;
  }),
  body('categoryIds').optional().isArray(),
  body('categoryIds.*').optional().custom((v) => {
    if (!mongoose.Types.ObjectId.isValid(v)) throw new Error('categoryId inválido');
    return true;
  }),
];

/* =========================================================
 *  CANCEL
 * ========================================================= */
const cancelVoucherValidator = [
  body('reason').optional({ values: 'falsy' }).isString().trim().isLength({ max: 300 }),
];

/* =========================================================
 *  Params & Query
 * ========================================================= */
const voucherIdParamValidator = [paramObjectId('id', 'ID de voucher')];
const codeParamValidator = [
  param('code').trim().notEmpty().withMessage('El código es obligatorio'),
];
const clientIdParamValidator = [paramObjectId('clientId', 'ID de cliente')];

const listQueryValidator = [
  query('status').optional().isIn(VOUCHER_STATUSES),
  query('type').optional().isIn(VOUCHER_TYPES),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
];

module.exports = {
  createVoucherValidator,
  bulkCreateVoucherValidator,
  validateVoucherValidator,
  cancelVoucherValidator,
  voucherIdParamValidator,
  codeParamValidator,
  clientIdParamValidator,
  listQueryValidator,
};