const { body, param, query } = require('express-validator');
const mongoose = require('mongoose');
const { PAYMENT_METHODS, DISCOUNT_TYPES, CHANNELS } = require('../models/Sale');

const objectIdInBody = (field, label) =>
  body(field)
    .optional({ values: 'null' })
    .custom((v) => {
      if (v && !mongoose.Types.ObjectId.isValid(v)) {
        throw new Error(`${label} inválido`);
      }
      return true;
    });

const paramObjectId = (field, label) =>
  param(field).custom((v) => {
    if (!mongoose.Types.ObjectId.isValid(v)) {
      throw new Error(`${label} inválido`);
    }
    return true;
  });

/* =========================================================
 *  CREATE SALE
 * ========================================================= */
const createSaleValidator = [
  objectIdInBody('clientId', 'clientId'),
  objectIdInBody('sellerId', 'sellerId'),

  body('items')
    .isArray({ min: 1 })
    .withMessage('items debe ser un array con al menos un producto'),
  body('items.*.productId')
    .notEmpty()
    .withMessage('productId es obligatorio')
    .custom((v) => {
      if (!mongoose.Types.ObjectId.isValid(v)) {
        throw new Error('productId inválido');
      }
      return true;
    }),
  body('items.*.size').trim().notEmpty().withMessage('El talle es obligatorio'),
  body('items.*.color').trim().notEmpty().withMessage('El color es obligatorio'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('La cantidad debe ser un entero positivo'),
  body('items.*.unitPrice').optional().isFloat({ min: 0 }),
  body('items.*.discount').optional().isFloat({ min: 0 }),

  body('discountType')
    .optional()
    .isIn(DISCOUNT_TYPES)
    .withMessage(`discountType inválido. Use: ${DISCOUNT_TYPES.join(', ')}`),
  body('discountValue').optional().isFloat({ min: 0 }),
  body('taxRate').optional().isFloat({ min: 0, max: 100 }),

  body('payments').optional().isArray(),
  body('payments.*.method')
    .optional()
    .isIn(PAYMENT_METHODS)
    .withMessage(`Método de pago inválido. Use: ${PAYMENT_METHODS.join(', ')}`),
  body('payments.*.amount')
    .if((_, { req }) => req.body.payments && req.body.payments.length > 0)
    .isFloat({ gt: 0 })
    .withMessage('El monto del pago debe ser positivo'),
  body('payments.*.reference').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
  body('payments.*.installments').optional().isInt({ min: 1 }),

  body('voucherCodes')
    .optional()
    .isArray()
    .withMessage('voucherCodes debe ser un array de códigos'),
  body('voucherCodes.*')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Cada código de voucher debe ser un string no vacío')
    .isLength({ max: 50 }),

      body('couponCodes')
    .optional()
    .isArray()
    .withMessage('couponCodes debe ser un array'),
  body('couponCodes.*')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 30 }),

  body('channel')
    .optional()
    .isIn(CHANNELS)
    .withMessage(`channel inválido. Use: ${CHANNELS.join(', ')}`),
  body('notes').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }),
];

/* =========================================================
 *  ADD PAYMENT
 * ========================================================= */
const addPaymentValidator = [
  body('method')
    .notEmpty()
    .withMessage('El método de pago es obligatorio')
    .isIn(PAYMENT_METHODS)
    .withMessage(`Método inválido. Use: ${PAYMENT_METHODS.join(', ')}`),
  body('amount')
    .notEmpty()
    .withMessage('El monto es obligatorio')
    .isFloat({ gt: 0 })
    .withMessage('El monto debe ser mayor a cero'),
  body('reference').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
  body('installments').optional().isInt({ min: 1 }),
  body('bankAccountId').optional({ values: 'null' }).custom((v) => {
    if (v && !mongoose.Types.ObjectId.isValid(v)) {
      throw new Error('bankAccountId inválido');
    }
    return true;
  }),
];

/* =========================================================
 *  CANCEL SALE
 * ========================================================= */
const cancelSaleValidator = [
  body('reason').optional({ values: 'falsy' }).isString().trim().isLength({ max: 500 }),
];

/* =========================================================
 *  Params y Query
 * ========================================================= */
const saleIdParamValidator = [paramObjectId('id', 'ID de venta')];
const saleNumberParamValidator = [
  param('saleNumber').trim().notEmpty().withMessage('saleNumber es obligatorio'),
];

const statsQueryValidator = [
  query('from').optional().isISO8601().withMessage('from inválido'),
  query('to').optional().isISO8601().withMessage('to inválido'),
];

const topProductsQueryValidator = [
  query('from').optional().isISO8601().withMessage('from inválido'),
  query('to').optional().isISO8601().withMessage('to inválido'),
  query('limit').optional().isInt({ min: 1, max: 50 }),
];

module.exports = {
  createSaleValidator,
  addPaymentValidator,
  cancelSaleValidator,
  saleIdParamValidator,
  saleNumberParamValidator,
  statsQueryValidator,
  topProductsQueryValidator,
};