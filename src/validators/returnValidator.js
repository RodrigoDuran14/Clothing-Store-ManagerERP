const { body, param, query } = require('express-validator');
const mongoose = require('mongoose');
const {
  RETURN_TYPES,
  REFUND_METHODS,
  REASON_TYPES,
} = require('../models/Return');

const objectIdInBody = (field, label, optional = true) => {
  const rule = body(field);
  if (optional) rule.optional({ values: 'null' });
  else rule.notEmpty().withMessage(`${label} es obligatorio`);

  return rule.custom((v) => {
    if (v && !mongoose.Types.ObjectId.isValid(v)) {
      throw new Error(`${label} inválido`);
    }
    return true;
  });
};

const paramObjectId = (field, label) =>
  param(field).custom((v) => {
    if (!mongoose.Types.ObjectId.isValid(v)) {
      throw new Error(`${label} inválido`);
    }
    return true;
  });

/* =========================================================
 *  Item validation (devuelto o exchange)
 * ========================================================= */
const itemRules = (prefix, required = true) => {
  const f = (name) => `${prefix}${name}`;
  const rules = [];

  if (required) {
    rules.push(
      body(f('')).isArray({ min: 1 }).withMessage(`${prefix.slice(0, -1)} debe tener al menos un item`)
    );
  }

  rules.push(
    body(f('*.productId'))
      .notEmpty()
      .withMessage('productId es obligatorio')
      .custom((v) => {
        if (!mongoose.Types.ObjectId.isValid(v)) {
          throw new Error('productId inválido');
        }
        return true;
      }),
    body(f('*.size')).trim().notEmpty().withMessage('El talle es obligatorio'),
    body(f('*.color')).trim().notEmpty().withMessage('El color es obligatorio'),
    body(f('*.quantity'))
      .isInt({ min: 1 })
      .withMessage('La cantidad debe ser un entero positivo')
  );

  return rules;
};

/* =========================================================
 *  CREATE RETURN
 * ========================================================= */
const createReturnValidator = [
  body('saleId')
    .notEmpty()
    .withMessage('saleId es obligatorio')
    .custom((v) => {
      if (!mongoose.Types.ObjectId.isValid(v)) {
        throw new Error('saleId inválido');
      }
      return true;
    }),

  body('type')
    .notEmpty()
    .withMessage('type es obligatorio')
    .isIn(RETURN_TYPES)
    .withMessage(`type inválido. Use: ${RETURN_TYPES.join(', ')}`),

  ...itemRules('items.', true),

  // exchangeItems obligatorio solo si type === 'exchange'
  body('exchangeItems')
    .if((_, { req }) => req.body.type === 'exchange')
    .isArray({ min: 1 })
    .withMessage('exchangeItems debe tener al menos un item para un exchange'),
  body('exchangeItems.*.productId')
    .if((_, { req }) => req.body.type === 'exchange')
    .notEmpty()
    .withMessage('productId es obligatorio')
    .custom((v) => {
      if (v && !mongoose.Types.ObjectId.isValid(v)) {
        throw new Error('productId inválido en exchangeItems');
      }
      return true;
    }),
  body('exchangeItems.*.size')
    .if((_, { req }) => req.body.type === 'exchange')
    .trim()
    .notEmpty()
    .withMessage('El talle es obligatorio'),
  body('exchangeItems.*.color')
    .if((_, { req }) => req.body.type === 'exchange')
    .trim()
    .notEmpty()
    .withMessage('El color es obligatorio'),
  body('exchangeItems.*.quantity')
    .if((_, { req }) => req.body.type === 'exchange')
    .isInt({ min: 1 })
    .withMessage('La cantidad debe ser un entero positivo'),

  body('reasonType')
    .optional()
    .isIn(REASON_TYPES)
    .withMessage(`reasonType inválido. Use: ${REASON_TYPES.join(', ')}`),
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('El motivo es obligatorio')
    .isLength({ max: 500 }),
  body('clientNotes').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }),

  body('refundMethod')
    .if((_, { req }) => req.body.type === 'refund')
    .notEmpty()
    .withMessage('refundMethod es obligatorio para devoluciones')
    .isIn(REFUND_METHODS)
    .withMessage(`refundMethod inválido. Use: ${REFUND_METHODS.join(', ')}`),
];

/* =========================================================
 *  APPROVE / REJECT / CANCEL
 * ========================================================= */
const approveReturnValidator = [
  body('notes').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }),
];

const rejectReturnValidator = [
  body('rejectionReason')
    .trim()
    .notEmpty()
    .withMessage('El motivo de rechazo es obligatorio')
    .isLength({ max: 500 }),
];

const cancelReturnValidator = [
  body('reason').optional({ values: 'falsy' }).isString().trim().isLength({ max: 500 }),
];

/* =========================================================
 *  PROCESS RETURN
 * ========================================================= */
const processReturnValidator = [
  body('refundMethod')
    .if((_, { req }) => req.body.balanceDue !== 0 || req.body.type === 'refund')
    .optional({ values: 'null' })
    .isIn(REFUND_METHODS)
    .withMessage(`refundMethod inválido. Use: ${REFUND_METHODS.join(', ')}`),
  body('refundReference').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
  body('balancePaymentMethod')
    .optional({ values: 'null' })
    .isIn(REFUND_METHODS)
    .withMessage(`balancePaymentMethod inválido`),
  body('balancePaymentReference')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .isLength({ max: 100 }),
];

/* =========================================================
 *  Params & Query
 * ========================================================= */
const returnIdParamValidator = [paramObjectId('id', 'ID de devolución')];
const returnNumberParamValidator = [
  param('returnNumber').trim().notEmpty().withMessage('returnNumber es obligatorio'),
];
const clientIdParamValidator = [paramObjectId('clientId', 'ID de cliente')];

const statsQueryValidator = [
  query('from').optional().isISO8601().withMessage('from inválido'),
  query('to').optional().isISO8601().withMessage('to inválido'),
];

module.exports = {
  createReturnValidator,
  approveReturnValidator,
  rejectReturnValidator,
  cancelReturnValidator,
  processReturnValidator,
  returnIdParamValidator,
  returnNumberParamValidator,
  clientIdParamValidator,
  statsQueryValidator,
};