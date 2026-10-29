const { body, param } = require('express-validator');
const mongoose = require('mongoose');
const { ALL_ROLES, ROLES } = require('../config/roles');

const createUserValidator = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('El nombre es obligatorio')
    .isLength({ min: 2, max: 100 })
    .withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  body('email')
    .trim()
    .notEmpty()
    .withMessage('El email es obligatorio')
    .isEmail()
    .withMessage('Email inválido')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('La contraseña es obligatoria')
    .isLength({ min: 8 })
    .withMessage('La contraseña debe tener al menos 8 caracteres'),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('image').optional().isString(),
  body('role')
    .optional()
    .isIn(ALL_ROLES)
    .withMessage(`Rol inválido. Valores permitidos: ${ALL_ROLES.join(', ')}`),
  body('partnerId')
    .optional({ values: 'null' })
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('partnerId inválido');
      }
      return true;
    }),
  body().custom((_, { req }) => {
    // partner/employee requieren partnerId (se validará en controller)
    const { role, partnerId } = req.body;
    if (
      (role === ROLES.PARTNER || role === ROLES.EMPLOYEE) &&
      !partnerId
    ) {
      throw new Error(
        'Los usuarios con rol partner o employee requieren un partnerId'
      );
    }
    return true;
  }),
];

const updateUserValidator = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Email inválido')
    .normalizeEmail(),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
  body('image').optional().isString(),

  // 🚫 Bloqueo explícito: role/partnerId no pertenecen a esta ruta
  body().custom((_, { req }) => {
    const forbidden = ['role', 'partnerId'].filter(
      (f) => req.body[f] !== undefined
    );
    if (forbidden.length > 0) {
      throw new Error(
        `Los campos ${forbidden.join("', '")} no se pueden modificar por esta ruta. `
      );
    }
    return true;
  }),
];

const updateUserRoleValidator = [
  body('role')
    .notEmpty()
    .withMessage('El rol es obligatorio')
    .isIn(ALL_ROLES)
    .withMessage(`Rol inválido. Valores permitidos: ${ALL_ROLES.join(', ')}`),

  body('partnerId')
    .optional({ values: 'null' })
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('partnerId inválido');
      }
      return true;
    }),

  body().custom((_, { req }) => {
    const { role, partnerId } = req.body;
    if ((role === ROLES.PARTNER || role === ROLES.EMPLOYEE) && !partnerId) {
      throw new Error(
        'Los usuarios con rol partner o employee requieren un partnerId'
      );
    }
    return true;
  }),
];

const userIdParamValidator = [
  param('id').custom((value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('ID de usuario inválido');
    }
    return true;
  }),
];

module.exports = { createUserValidator, updateUserValidator, updateUserRoleValidator, userIdParamValidator };