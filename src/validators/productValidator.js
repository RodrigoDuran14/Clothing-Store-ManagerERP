const { body, param, query } = require('express-validator');
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

const paramObjectId = (field, label) =>
  param(field).custom((value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error(`${label} inválido`);
    }
    return true;
  });

/* =========================================================
 *  CREATE
 * ========================================================= */
const createProductValidator = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('El nombre es obligatorio')
    .isLength({ min: 2, max: 200 })
    .withMessage('El nombre debe tener entre 2 y 200 caracteres'),
  body('description')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 5000 }),
  objectIdRule('categoryId', 'categoryId'),
  objectIdRule('supplierId', 'supplierId'),
  objectIdRule('partnerId', 'partnerId'),
  body('price')
    .notEmpty()
    .withMessage('El precio es obligatorio')
    .isFloat({ min: 0 })
    .withMessage('El precio debe ser un número positivo'),
  body('webPrice').optional({ values: 'null' }).isFloat({ min: 0 }),
  body('cost').optional().isFloat({ min: 0 }),
  body('isActive').optional().isBoolean(),
  body('isFeatured').optional().isBoolean(),
  body('isVisibleOnWeb').optional().isBoolean(),
  body('weightKg').optional().isFloat({ min: 0 }),
  body('tags').optional().isArray(),
  body('tags.*').optional().isString().trim(),
  body('variants')
    .optional()
    .isArray()
    .withMessage('variants debe ser un array'),
  body('variants.*.size').optional().isString().trim(),
  body('variants.*.color').optional().isString().trim(),
  body('variants.*.colorCode').optional().isString().trim(),
  body('variants.*.stock').optional().isInt({ min: 0 }),
  body('variants.*.minStock').optional().isInt({ min: 0 }),
  body('images').optional().isArray(),
  body('images.*.url')
    .optional()
    .isString()
    .notEmpty()
    .withMessage('La URL de la imagen es obligatoria'),
  body('images.*.isMain').optional().isBoolean(),
];

/* =========================================================
 *  UPDATE (perfil only)
 * ========================================================= */
const updateProductValidator = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 }),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 5000 }),
  objectIdRule('categoryId', 'categoryId'),
  objectIdRule('supplierId', 'supplierId'),
  body('price').optional().isFloat({ min: 0 }),
  body('webPrice').optional({ values: 'null' }).isFloat({ min: 0 }),
  body('cost').optional().isFloat({ min: 0 }),
  body('isFeatured').optional().isBoolean(),
  body('isVisibleOnWeb').optional().isBoolean(),
  body('weightKg').optional().isFloat({ min: 0 }),
  body('tags').optional().isArray(),
  body('tags.*').optional().isString().trim(),

  // 🚫 Campos prohibidos (endpoints dedicados)
  body().custom((_, { req }) => {
    const forbidden = ['variants', 'barcode', 'partnerId', 'isActive'].filter(
      (f) => req.body[f] !== undefined
    );
    if (forbidden.length > 0) {
      throw new Error(
        `Los campos '${forbidden.join("', '")}' no se pueden modificar por esta ruta. ` +
          'Use los endpoints específicos (/status, /stock, /images).'
      );
    }
    return true;
  }),
];

/* =========================================================
 *  STOCK
 * ========================================================= */
const updateStockValidator = [
  body('size').trim().notEmpty().withMessage('El talle es obligatorio'),
  body('color').trim().notEmpty().withMessage('El color es obligatorio'),
  body('quantity')
    .notEmpty()
    .withMessage('La cantidad es obligatoria')
    .isFloat({ min: 0 })
    .withMessage('La cantidad debe ser un número positivo'),
  body('type')
    .notEmpty()
    .withMessage('El tipo de movimiento es obligatorio')
    .isIn(['sale', 'return', 'add', 'remove', 'adjustment'])
    .withMessage(
      "Tipo inválido. Use 'sale', 'return', 'add', 'remove' o 'adjustment'"
    ),
];

const checkStockValidator = [
  query('size').trim().notEmpty().withMessage('El talle es obligatorio'),
  query('color').trim().notEmpty().withMessage('El color es obligatorio'),
  query('quantity')
    .optional()
    .isFloat({ min: 1 })
    .withMessage('La cantidad debe ser mayor a cero'),
];

/* =========================================================
 *  IMAGES
 * ========================================================= */
const addImageValidator = [
  body('url')
    .trim()
    .notEmpty()
    .withMessage('La URL de la imagen es obligatoria'),
  body('isMain').optional().isBoolean(),
];

/* =========================================================
 *  Params
 * ========================================================= */
const productIdParamValidator = [paramObjectId('id', 'ID de producto')];
const imageIdParamValidator = [
  paramObjectId('id', 'ID de producto'),
  paramObjectId('imageId', 'ID de imagen'),
];
const barcodeParamValidator = [
  param('barcode')
    .trim()
    .notEmpty()
    .withMessage('El código de barras es obligatorio'),
];

module.exports = {
  createProductValidator,
  updateProductValidator,
  updateStockValidator,
  checkStockValidator,
  addImageValidator,
  productIdParamValidator,
  imageIdParamValidator,
  barcodeParamValidator,
};