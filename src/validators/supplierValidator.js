const { body, param } = require('express-validator');
const mongoose = require('mongoose');
const { TAX_CONDITIONS } = require('../models/Supplier');

const objectIdRule = (field, label) =>
  body(field)
    .optional({ values: 'null' })
    .custom((value) => {
      if (value && !mongoose.Types.ObjectId.isValid(value)) {
        throw new Error(`${label} inválido`);
      }
      return true;
    });

/* =========================================================
 *  Bank info (subdocumento)
 * ========================================================= */
const bankInfoRules = [
  body('bankInfo').optional().isObject().withMessage('bankInfo debe ser un objeto'),
  body('bankInfo.bank').optional().isString().trim(),
  body('bankInfo.accountType').optional().isString().trim(),
  body('bankInfo.accountNumber').optional().isString().trim(),
  body('bankInfo.cbu').optional().isString().trim(),
  body('bankInfo.alias').optional().isString().trim(),
  body('bankInfo.holderName').optional().isString().trim(),
];

/* =========================================================
 *  CREATE
 * ========================================================= */
const createSupplierValidator = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('El nombre es obligatorio')
    .isLength({ min: 2, max: 100 })
    .withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  body('contactName')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 100 })
    .withMessage('El nombre de contacto no puede superar los 100 caracteres'),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('phone2').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('email')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('Email inválido')
    .normalizeEmail(),
  body('address').optional({ values: 'falsy' }).trim().isLength({ max: 300 }),
  body('taxId').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('taxCondition')
    .optional()
    .isIn(TAX_CONDITIONS)
    .withMessage(`Condición fiscal inválida. Valores permitidos: ${TAX_CONDITIONS.join(', ')}`),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  body('rating')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('La calificación debe ser un entero entre 1 y 5'),
  body('deliveryTime')
    .optional()
    .isInt({ min: 0 })
    .withMessage('El tiempo de entrega debe ser un entero positivo'),
  body('paymentTerms')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 100 }),
  body('isActive').optional().isBoolean(),
  body('suppliedProducts')
    .optional()
    .isArray()
    .withMessage('suppliedProducts debe ser un array de IDs'),
  body('suppliedProducts.*').custom((value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('ID de producto inválido en suppliedProducts');
    }
    return true;
  }),
  ...bankInfoRules,
];

/* =========================================================
 *  UPDATE (solo perfil)
 *  Bloquea explícitamente campos financieros / de auditoría.
 * ========================================================= */
const updateSupplierValidator = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  body('contactName')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 100 }),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('phone2').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('email')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('Email inválido')
    .normalizeEmail(),
  body('address').optional({ values: 'falsy' }).trim().isLength({ max: 300 }),
  body('taxId').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('taxCondition')
    .optional()
    .isIn(TAX_CONDITIONS)
    .withMessage(`Condición fiscal inválida`),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  body('rating')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('La calificación debe ser un entero entre 1 y 5'),
  body('deliveryTime')
    .optional()
    .isInt({ min: 0 })
    .withMessage('El tiempo de entrega debe ser un entero positivo'),
  body('paymentTerms')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 100 }),
  ...bankInfoRules,

  // 🚫 Bloqueo explícito: campos de auditoría / financieros
  body().custom((_, { req }) => {
    const forbidden = [
      'debt',
      'totalPurchases',
      'lastPurchase',
      'suppliedProducts',
      'isActive',
    ].filter((f) => req.body[f] !== undefined);

    if (forbidden.length > 0) {
      throw new Error(
        `Los campos '${forbidden.join("', '")}' no se pueden modificar por esta ruta. ` +
          'Use los endpoints específicos (status, purchases, debt, products).'
      );
    }
    return true;
  }),
];

/* =========================================================
 *  ID param
 * ========================================================= */
const supplierIdParamValidator = [
  param('id').custom((value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('ID de proveedor inválido');
    }
    return true;
  }),
];

/* =========================================================
 *  Operaciones financieras y de productos
 * ========================================================= */
const recordPurchaseValidator = [
  body('amount')
    .notEmpty()
    .withMessage('El monto de la compra es obligatorio')
    .isFloat({ gt: 0 })
    .withMessage('El monto debe ser mayor a cero'),
  body('paid')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('El monto abonado no puede ser negativo'),
  body().custom((_, { req }) => {
    const { amount, paid } = req.body;
    if (paid !== undefined && Number(paid) > Number(amount)) {
      throw new Error('El monto abonado no puede superar el total de la compra');
    }
    return true;
  }),
];

const updateDebtValidator = [
  body('amount')
    .notEmpty()
    .withMessage('El monto del ajuste es obligatorio')
    .isFloat()
    .withMessage('El monto debe ser numérico')
    .custom((value) => {
      if (Number(value) === 0) {
        throw new Error('El ajuste de deuda debe ser distinto de cero');
      }
      return true;
    }),
];

const addProductValidator = [
  body('productId')
    .notEmpty()
    .withMessage('productId es obligatorio')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('ID de producto inválido');
      }
      return true;
    }),
];

const productIdParamValidator = [
  param('productId').custom((value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('ID de producto inválido');
    }
    return true;
  }),
];

module.exports = {
  createSupplierValidator,
  updateSupplierValidator,
  supplierIdParamValidator,
  recordPurchaseValidator,
  updateDebtValidator,
  addProductValidator,
  productIdParamValidator,
};