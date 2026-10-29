const { body, param } = require('express-validator');
const mongoose = require('mongoose');

const objectIdRule = (field, label) =>
  body(field)
    .optional({ values: 'null' })
    .custom((value) => {
      if (value && !mongoose.Types.ObjectId.isValid(value)) {
        throw new Error(`${label} inválido`);
      }
      return true;
    });

const createCategoryValidator = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('El nombre es obligatorio')
    .isLength({ min: 2, max: 100 })
    .withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('La descripción no puede superar los 1000 caracteres'),
  body('image').optional().isString(),
  body('icon').optional().isString(),
  objectIdRule('parentId', 'parentId'),
  objectIdRule('partnerId', 'partnerId'),
  body('order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('order debe ser un entero positivo'),
  body('isActive').optional().isBoolean(),
  body('isFeatured').optional().isBoolean(),
];

const updateCategoryValidator = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('La descripción no puede superar los 1000 caracteres'),
  body('image').optional().isString(),
  body('icon').optional().isString(),
  objectIdRule('parentId', 'parentId'),
  objectIdRule('partnerId', 'partnerId'),
  body('order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('order debe ser un entero positivo'),
  body('isActive').optional().isBoolean(),
  body('isFeatured').optional().isBoolean(),
];

const categoryIdParamValidator = [
  param('id').custom((value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('ID de categoría inválido');
    }
    return true;
  }),
];

const reorderCategoriesValidator = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('items debe ser un array con al menos un elemento'),
  body('items.*.id').custom((value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('ID de categoría inválido en items');
    }
    return true;
  }),
  body('items.*.order')
    .isInt({ min: 0 })
    .withMessage('order debe ser un entero positivo'),
];

module.exports = {
  createCategoryValidator,
  updateCategoryValidator,
  categoryIdParamValidator,
  reorderCategoriesValidator,
};