const { body, param, query } = require('express-validator');
const mongoose = require('mongoose');
const {
  GENDERS,
  CLIENT_CATEGORIES,
} = require('../models/Client');

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

const addressRules = (prefix = '') => {
  const f = (name) => `${prefix}${name}`;
  return [
    body(f('label')).optional({ values: 'falsy' }).isString().trim().isLength({ max: 50 }),
    body(f('street'))
      .if((_, { req }) => prefix === '' || req.body.addresses !== undefined)
      .trim()
      .notEmpty()
      .withMessage('La calle es obligatoria'),
    body(f('city'))
      .if((_, { req }) => prefix === '' || req.body.addresses !== undefined)
      .trim()
      .notEmpty()
      .withMessage('La ciudad es obligatoria'),
    body(f('state')).optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
    body(f('postalCode')).optional({ values: 'falsy' }).isString().trim().isLength({ max: 20 }),
    body(f('country')).optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
    body(f('notes')).optional({ values: 'falsy' }).isString().trim().isLength({ max: 300 }),
    body(f('isMain')).optional().isBoolean(),
  ];
};

/* =========================================================
 *  CREATE
 * ========================================================= */
const createClientValidator = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('El nombre es obligatorio')
    .isLength({ min: 2, max: 100 })
    .withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  body('email')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('Email inválido')
    .normalizeEmail(),
  body('phone')
    .trim()
    .notEmpty()
    .withMessage('El teléfono es obligatorio')
    .isLength({ max: 30 })
    .withMessage('El teléfono no puede superar los 30 caracteres'),
  body('phone2').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('birthDate')
    .optional({ values: 'null' })
    .isISO8601()
    .withMessage('Fecha de nacimiento inválida')
    .custom((value) => {
      if (new Date(value) > new Date()) {
        throw new Error('La fecha de nacimiento no puede ser futura');
      }
      return true;
    }),
  body('gender').optional().isIn(GENDERS).withMessage('Género inválido'),
  body('taxId').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  body('category')
    .optional()
    .isIn(CLIENT_CATEGORIES)
    .withMessage(`Categoría inválida. Use: ${CLIENT_CATEGORIES.join(', ')}`),
  body('preferences').optional().isObject(),
  body('preferences.favoriteColors').optional().isArray(),
  body('preferences.preferredCategories').optional().isArray(),
  body('preferences.preferredCategories.*')
    .optional()
    .custom((v) => {
      if (!mongoose.Types.ObjectId.isValid(v)) {
        throw new Error('ID de categoría inválido en preferencias');
      }
      return true;
    }),
  body('preferences.favoriteBrands').optional().isArray(),
  body('preferences.observations').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }),
  body('addresses').optional().isArray(),
  ...addressRules('addresses.*.'),
];

/* =========================================================
 *  UPDATE (perfil only)
 * ========================================================= */
const updateClientValidator = [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('email')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('Email inválido')
    .normalizeEmail(),
  body('phone').optional().trim().isLength({ max: 30 }),
  body('phone2').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('birthDate')
    .optional({ values: 'null' })
    .isISO8601()
    .withMessage('Fecha de nacimiento inválida'),
  body('gender').optional().isIn(GENDERS).withMessage('Género inválido'),
  body('taxId').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),

  // 🚫 Campos prohibidos (endpoints dedicados o computados)
  body().custom((_, { req }) => {
    const forbidden = [
      'creditAccount',
      'purchaseHistory',
      'addresses',
      'preferences',
      'category',
      'isActive',
    ].filter((f) => req.body[f] !== undefined);
    if (forbidden.length > 0) {
      throw new Error(
        `Los campos '${forbidden.join("', '")}' no se pueden modificar por esta ruta. ` +
          'Use los endpoints específicos (/status, /preferences, /addresses, /credit).'
      );
    }
    return true;
  }),
];

/* =========================================================
 *  CRÉDITO
 * ========================================================= */
const enableCreditValidator = [
  body('creditLimit')
    .notEmpty()
    .withMessage('El límite de crédito es obligatorio')
    .isFloat({ gt: 0 })
    .withMessage('El límite de crédito debe ser un número positivo'),
];

const registerPaymentValidator = [
  body('amount')
    .notEmpty()
    .withMessage('El monto del pago es obligatorio')
    .isFloat({ gt: 0 })
    .withMessage('El monto debe ser mayor a cero'),
  body('method')
    .optional()
    .isIn(['cash', 'transfer', 'card', 'other'])
    .withMessage("Método inválido. Use: 'cash', 'transfer', 'card', 'other'"),
  body('description').optional({ values: 'falsy' }).isString().trim().isLength({ max: 300 }),
];

const checkCreditLimitValidator = [
  query('amount')
    .notEmpty()
    .withMessage('El monto es obligatorio')
    .isFloat({ gt: 0 })
    .withMessage('El monto debe ser mayor a cero'),
];

/* =========================================================
 *  PREFERENCIAS
 * ========================================================= */
const updatePreferencesValidator = [
  body('sizes').optional().isObject(),
  body('sizes.top').optional({ values: 'falsy' }).isString().trim().isLength({ max: 10 }),
  body('sizes.bottom').optional({ values: 'falsy' }).isString().trim().isLength({ max: 10 }),
  body('sizes.shoe').optional({ values: 'falsy' }).isString().trim().isLength({ max: 10 }),
  body('favoriteColors').optional().isArray(),
  body('preferredCategories').optional().isArray(),
  body('preferredCategories.*').optional().custom((v) => {
    if (!mongoose.Types.ObjectId.isValid(v)) {
      throw new Error('ID de categoría inválido en preferencias');
    }
    return true;
  }),
  body('favoriteBrands').optional().isArray(),
  body('shoeSize').optional({ values: 'falsy' }).isString().trim().isLength({ max: 10 }),
  body('pantsSize').optional({ values: 'falsy' }).isString().trim().isLength({ max: 10 }),
  body('observations').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }),
];

/* =========================================================
 *  DIRECCIONES
 * ========================================================= */
const addAddressValidator = [
  body('street')
    .trim()
    .notEmpty()
    .withMessage('La calle es obligatoria')
    .isLength({ max: 200 }),
  body('city')
    .trim()
    .notEmpty()
    .withMessage('La ciudad es obligatoria')
    .isLength({ max: 100 }),
  body('label').optional({ values: 'falsy' }).isString().trim().isLength({ max: 50 }),
  body('state').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
  body('postalCode').optional({ values: 'falsy' }).isString().trim().isLength({ max: 20 }),
  body('country').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
  body('notes').optional({ values: 'falsy' }).isString().trim().isLength({ max: 300 }),
  body('isMain').optional().isBoolean(),
];

const updateAddressValidator = [
  body('street').optional().trim().isLength({ min: 1, max: 200 }),
  body('city').optional().trim().isLength({ min: 1, max: 100 }),
  body('label').optional({ values: 'falsy' }).isString().trim().isLength({ max: 50 }),
  body('state').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
  body('postalCode').optional({ values: 'falsy' }).isString().trim().isLength({ max: 20 }),
  body('country').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
  body('notes').optional({ values: 'falsy' }).isString().trim().isLength({ max: 300 }),
  body('isMain').optional().isBoolean(),
];

/* =========================================================
 *  Params
 * ========================================================= */
const clientIdParamValidator = [paramObjectId('id', 'ID de cliente')];
const addressIdParamValidator = [
  paramObjectId('id', 'ID de cliente'),
  paramObjectId('addressId', 'ID de dirección'),
];

module.exports = {
  createClientValidator,
  updateClientValidator,
  enableCreditValidator,
  registerPaymentValidator,
  checkCreditLimitValidator,
  updatePreferencesValidator,
  addAddressValidator,
  updateAddressValidator,
  clientIdParamValidator,
  addressIdParamValidator,
};