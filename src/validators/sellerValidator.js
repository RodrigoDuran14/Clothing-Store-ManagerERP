const { body, param, query } = require('express-validator');
const mongoose = require('mongoose');
const { COMMISSION_TYPES, SELLER_ROLES } = require('../models/Seller');

const objectIdRule = (field, label) =>
  body(field)
    .optional({ values: 'null' })
    .custom((value) => {
      if (value && !mongoose.Types.ObjectId.isValid(value)) {
        throw new Error(`${label} inválido`);
      }
      return true;
    });

const paramObjectId = (field, label) =>
  param(field).custom((value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error(`${label} inválido`);
    }
    return true;
  });

/* =========================================================
 *  SHIFTS
 * ========================================================= */
const shiftRules = (prefix = '') => {
  const f = (name) => `${prefix}${name}`;
  return [
    body(f('name'))
      .trim()
      .notEmpty()
      .withMessage('El nombre del turno es obligatorio')
      .isLength({ max: 50 }),
    body(f('daysOfWeek'))
      .isArray({ min: 1 })
      .withMessage('daysOfWeek debe ser un array con al menos un día'),
    body(f('daysOfWeek.*'))
      .isInt({ min: 0, max: 6 })
      .withMessage('Los días deben estar entre 0 (Dom) y 6 (Sáb)'),
    body(f('startTime'))
      .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
      .withMessage('Hora de inicio inválida (HH:MM)'),
    body(f('endTime'))
      .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
      .withMessage('Hora de fin inválida (HH:MM)'),
    body(f('isActive')).optional().isBoolean(),
  ];
};

/* =========================================================
 *  CREATE
 * ========================================================= */
const createSellerValidator = [
  body('userId')
    .notEmpty()
    .withMessage('El userId es obligatorio')
    .custom((v) => {
      if (!mongoose.Types.ObjectId.isValid(v)) {
        throw new Error('userId inválido');
      }
      return true;
    }),
  body('employeeCode')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 20 })
    .withMessage('El legajo no puede superar los 20 caracteres'),
  body('shifts').optional().isArray(),
  ...shiftRules('shifts.*.'),
  body('commissionType')
    .optional()
    .isIn(COMMISSION_TYPES)
    .withMessage(`Tipo inválido. Use: ${COMMISSION_TYPES.join(', ')}`),
  body('commissionRate').optional().isFloat({ min: 0, max: 100 }),
  body('fixedCommissionAmount').optional().isFloat({ min: 0 }),
  body('commissionTiers').optional().isArray(),
  body('commissionTiers.*.minAmount').optional().isFloat({ min: 0 }),
  body('commissionTiers.*.maxAmount').optional({ values: 'null' }).isFloat({ min: 0 }),
  body('commissionTiers.*.rate').optional().isFloat({ min: 0, max: 100 }),
  body('notes').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }),
];

/* =========================================================
 *  UPDATE (perfil only)
 * ========================================================= */
const updateSellerValidator = [
  body('employeeCode')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 20 }),
  body('notes').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }),

  // 🚫 Bloqueo explícito
  body().custom((_, { req }) => {
    const forbidden = [
      'userId',
      'role',
      'commissionType',
      'commissionRate',
      'fixedCommissionAmount',
      'commissionTiers',
      'shifts',
      'isActive',
      'totalSales',
      'totalCommission',
      'pendingCommission',
      'commissionHistory',
    ].filter((f) => req.body[f] !== undefined);
    if (forbidden.length > 0) {
      throw new Error(
        `Los campos '${forbidden.join("', '")}' no se pueden modificar por esta ruta. ` +
          'Use los endpoints específicos (/shifts, /commission, /status).'
      );
    }
    return true;
  }),
];

/* =========================================================
 *  SHIFTS endpoints
 * ========================================================= */
const addShiftValidator = shiftRules();
const updateShiftValidator = [
  body('name').optional().trim().isLength({ max: 50 }),
  body('daysOfWeek').optional().isArray({ min: 1 }),
  body('daysOfWeek.*')
    .optional()
    .isInt({ min: 0, max: 6 })
    .withMessage('Los días deben estar entre 0 (Dom) y 6 (Sáb)'),
  body('startTime')
    .optional()
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    .withMessage('Hora de inicio inválida (HH:MM)'),
  body('endTime')
    .optional()
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    .withMessage('Hora de fin inválida (HH:MM)'),
  body('isActive').optional().isBoolean(),
];

/* =========================================================
 *  COMMISSION config
 * ========================================================= */
const updateCommissionValidator = [
  body('commissionType')
    .notEmpty()
    .withMessage('El tipo de comisión es obligatorio')
    .isIn(COMMISSION_TYPES)
    .withMessage(`Tipo inválido. Use: ${COMMISSION_TYPES.join(', ')}`),
  body('commissionRate').optional().isFloat({ min: 0, max: 100 }),
  body('fixedCommissionAmount').optional().isFloat({ min: 0 }),
  body('commissionTiers').optional().isArray(),
  body('commissionTiers.*.minAmount').optional().isFloat({ min: 0 }),
  body('commissionTiers.*.maxAmount').optional({ values: 'null' }).isFloat({ min: 0 }),
  body('commissionTiers.*.rate').optional().isFloat({ min: 0, max: 100 }),
  // Coherencia por tipo
  body().custom((_, { req }) => {
    const { commissionType, commissionRate, fixedCommissionAmount, commissionTiers } =
      req.body;

    if (commissionType === 'percentage' && (!commissionRate || commissionRate <= 0)) {
      throw new Error('commissionRate es obligatorio y > 0 para tipo percentage');
    }
    if (commissionType === 'fixed' && (!fixedCommissionAmount || fixedCommissionAmount <= 0)) {
      throw new Error('fixedCommissionAmount es obligatorio y > 0 para tipo fixed');
    }
    if (commissionType === 'tiered' && (!commissionTiers || commissionTiers.length === 0)) {
      throw new Error('commissionTiers es obligatorio para tipo tiered');
    }
    return true;
  }),
];

/* =========================================================
 *  SALE record (para uso interno / POS)
 * ========================================================= */
const recordSaleValidator = [
  body('amount')
    .notEmpty()
    .withMessage('El monto es obligatorio')
    .isFloat({ gt: 0 })
    .withMessage('El monto debe ser mayor a cero'),
  body('saleId')
    .notEmpty()
    .withMessage('El saleId es obligatorio')
    .custom((v) => {
      if (!mongoose.Types.ObjectId.isValid(v)) {
        throw new Error('saleId inválido');
      }
      return true;
    }),
];

/* =========================================================
 *  COMMISSION payment
 * ========================================================= */
const commissionPaymentValidator = [
  body('amount')
    .notEmpty()
    .withMessage('El monto es obligatorio')
    .isFloat({ gt: 0 })
    .withMessage('El monto debe ser mayor a cero'),
  body('period')
    .optional({ values: 'falsy' })
    .matches(/^\d{4}-\d{2}$/)
    .withMessage('Período inválido. Use formato YYYY-MM'),
  body('paymentMethod')
    .optional({ values: 'falsy' })
    .isIn(['cash', 'transfer', 'check', 'other'])
    .withMessage("Método inválido. Use: 'cash', 'transfer', 'check', 'other'"),
  body('paymentReference').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
];

/* =========================================================
 *  Params
 * ========================================================= */
const sellerIdParamValidator = [paramObjectId('id', 'ID de vendedor')];
const shiftIdParamValidator = [
  paramObjectId('id', 'ID de vendedor'),
  paramObjectId('shiftId', 'ID de turno'),
];

const periodQueryValidator = [
  query('period')
    .optional()
    .matches(/^\d{4}-\d{2}$/)
    .withMessage('Período inválido. Use formato YYYY-MM'),
];

const commissionReportValidator = [
  query('period')
    .optional()
    .matches(/^\d{4}-\d{2}$/)
    .withMessage('Período inválido. Use formato YYYY-MM'),
  query('from').optional().isISO8601().withMessage('from inválido'),
  query('to').optional().isISO8601().withMessage('to inválido'),
  query().custom((_, { req }) => {
    const { period, from, to } = req.query;
    if (!period && (!from || !to)) {
      throw new Error('Especifique period (YYYY-MM) o from y to');
    }
    return true;
  }),
];

module.exports = {
  createSellerValidator,
  updateSellerValidator,
  addShiftValidator,
  updateShiftValidator,
  updateCommissionValidator,
  recordSaleValidator,
  commissionPaymentValidator,
  sellerIdParamValidator,
  shiftIdParamValidator,
  periodQueryValidator,
  commissionReportValidator,
};