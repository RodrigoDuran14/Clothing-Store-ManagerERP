const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const { slugify } = require('../utils/helpers');
const { generateUniqueBarcode } = require('../services/barcodeService');

/* =========================================================
 *  Subdocumento: variante
 * ========================================================= */
const variantSchema = new mongoose.Schema(
  {
    size: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 10,
      default: 'U',
    },
    color: {
      type: String,
      trim: true,
      maxlength: 30,
      default: 'NA',
    },
    colorCode: { type: String, trim: true, maxlength: 10, default: null },
    stock: {
      type: Number,
      min: [0, 'El stock no puede ser negativo'],
      default: 0,
    },
    minStock: {
      type: Number,
      min: [0, 'El stock mínimo no puede ser negativo'],
      default: 0,
    },
    sku: { type: String, trim: true, uppercase: true },
  },
  { _id: true }
);

/* =========================================================
 *  Subdocumento: imagen
 * ========================================================= */
const imageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: [true, 'La URL de la imagen es obligatoria'],
      trim: true,
    },
    isMain: { type: Boolean, default: false },
  },
  { _id: true }
);

/* =========================================================
 *  Schema principal
 * ========================================================= */
const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      maxlength: [200, 'El nombre no puede superar los 200 caracteres'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [5000, 'La descripción no puede superar los 5000 caracteres'],
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      default: null,
    },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      default: null,
    },
    price: {
      type: Number,
      required: [true, 'El precio es obligatorio'],
      min: [0, 'El precio no puede ser negativo'],
    },
    webPrice: {
      type: Number,
      min: [0, 'El precio web no puede ser negativo'],
      default: null,
    },
    cost: {
      type: Number,
      min: [0, 'El costo no puede ser negativo'],
      default: 0,
    },
    barcode: { type: String, trim: true },
    variants: { type: [variantSchema], default: [] },
    images: { type: [imageSchema], default: [] },
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    isVisibleOnWeb: { type: Boolean, default: true },
    weightKg: {
      type: Number,
      min: [0, 'El peso no puede ser negativo'],
      default: 0,
    },
    tags: [{ type: String, trim: true, lowercase: true }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* =========================================================
 *  Índices
 * ========================================================= */
productSchema.index({ barcode: 1 }, { unique: true, sparse: true });
productSchema.index({ 'variants.sku': 1 }, { unique: true, sparse: true });
productSchema.index({ categoryId: 1, isActive: 1 });
productSchema.index({ supplierId: 1 });
productSchema.index({ partnerId: 1, isActive: 1 });
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ isVisibleOnWeb: 1, isActive: 1 });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });

/* =========================================================
 *  Virtuals
 * ========================================================= */
productSchema.virtual('totalStock').get(function () {
  if (!this.variants || this.variants.length === 0) return 0;
  return this.variants.reduce((sum, v) => sum + (v.stock || 0), 0);
});

productSchema.virtual('profitMargin').get(function () {
  if (!this.price || this.price <= 0) return 0;
  return Number((((this.price - (this.cost || 0)) / this.price) * 100).toFixed(2));
});

/* =========================================================
 *  pre('save'): SKU, barcode, herencia de partnerId, main image
 * ========================================================= */
productSchema.pre('save', async function (next) {
  try {
    // 1. Herencia de partnerId desde la categoría
    //    Solo si el usuario no seteó partnerId explícitamente en este save.
    if (!this.isModified('partnerId') && this.categoryId) {
      const Category = mongoose.model('Category');
      const cat = await Category.findById(this.categoryId).select('partnerId').lean();
      if (cat) this.partnerId = cat.partnerId || null;
    }

    // 2. Asegurar al menos una variante "Universal"
    if (this.isNew && (!this.variants || this.variants.length === 0)) {
      this.variants = [{ size: 'U', color: 'Único', stock: 0, minStock: 0 }];
    }

    // 3. Código de barras
    if (!this.barcode) {
      this.barcode = await generateUniqueBarcode(this.constructor);
    }

    // 4. SKU por variante
    if (this.variants && this.variants.length > 0) {
      for (const variant of this.variants) {
        if (!variant.sku) {
          variant.sku = await this.generateVariantSku(variant);
        }
      }
    }

    // 5. Garantizar exactamente una imagen principal
    if (this.images && this.images.length > 0) {
      const mainCount = this.images.filter((i) => i.isMain).length;
      if (mainCount === 0) {
        this.images[0].isMain = true;
      } else if (mainCount > 1) {
        let kept = false;
        this.images.forEach((img) => {
          if (img.isMain && !kept) kept = true;
          else if (img.isMain) img.isMain = false;
        });
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

/* =========================================================
 *  Métodos
 * ========================================================= */

/**
 * Genera un SKU único para una variante.
 * Formato: BASE-SIZE-COLOR-RAND (BASE 6 chars, SIZE/COLOR 4 chars, RAND 4 dígitos).
 */
productSchema.methods.generateVariantSku = async function (variant) {
  const base =
    slugify(this.name || 'PROD')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6) || 'PROD';
  const size =
    String(variant.size || 'U')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4) || 'U';
  const color =
    String(variant.color || 'NA')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4) || 'NA';

  for (let i = 0; i < 20; i++) {
    const rand = Math.floor(1000 + Math.random() * 9000);
    const sku = `${base}-${size}-${color}-${rand}`;
    const exists = await this.constructor
      .findOne({ 'variants.sku': sku })
      .select('_id')
      .lean();
    if (!exists) return sku;
  }
  throw new AppError('No se pudo generar un SKU único. Reintente.', 500);
};

/**
 * Consulta disponibilidad de una variante concreta.
 * No modifica nada. Devuelve información para que el caller decida.
 */
productSchema.methods.checkStock = function (size, color, quantity) {
  const qty = Number(quantity);
  const variant = this.variants.find(
    (v) =>
      v.size === String(size).toUpperCase() &&
      v.color === String(color)
  );
  if (!variant) {
    return { found: false, enough: false, stock: 0, requested: qty };
  }
  return {
    found: true,
    enough: variant.stock >= qty,
    stock: variant.stock,
    requested: qty,
    minStock: variant.minStock,
    sku: variant.sku,
  };
};

/**
 * Actualiza el stock de una variante.
 * No persiste: el controller debe llamar `save()`.
 *
 * Tipos de movimiento:
 *  - 'sale'       → stock -= quantity (rechaza si no alcanza)
 *  - 'return'     → stock += quantity
 *  - 'add'        → stock += quantity (ingreso de mercadería)
 *  - 'remove'     → stock -= quantity (merma, pérdida; rechaza si no alcanza)
 *  - 'adjustment' → stock = quantity (ajuste absoluto)
 */
productSchema.methods.updateStock = function (size, color, quantity, type) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty)) {
    throw new AppError('La cantidad debe ser numérica', 400);
  }

  const variant = this.variants.find(
    (v) =>
      v.size === String(size).toUpperCase() &&
      v.color === String(color)
  );
  if (!variant) {
    throw new AppError(
      `Variante no encontrada (talle: ${size}, color: ${color})`,
      404
    );
  }

  switch (type) {
    case 'sale':
    case 'remove': {
      if (qty <= 0) throw new AppError('La cantidad debe ser mayor a cero', 400);
      if (variant.stock < qty) {
        throw new AppError(
          `Stock insuficiente en variante ${variant.sku}. Disponible: ${variant.stock}, solicitado: ${qty}`,
          400
        );
      }
      variant.stock -= qty;
      break;
    }
    case 'return':
    case 'add': {
      if (qty <= 0) throw new AppError('La cantidad debe ser mayor a cero', 400);
      variant.stock += qty;
      break;
    }
    case 'adjustment': {
      if (qty < 0) throw new AppError('La cantidad no puede ser negativa', 400);
      variant.stock = qty;
      break;
    }
    default:
      throw new AppError(
        `Tipo de movimiento inválido: '${type}'. Use 'sale', 'return', 'add', 'remove' o 'adjustment'`,
        400
      );
  }

  return variant;
};

/* =========================================================
 *  Statics
 * ========================================================= */

/** Búsqueda por código de barras. Devuelve un Query (chainable). */
productSchema.statics.findByBarcode = function (barcode) {
  return this.findOne({ barcode, isActive: true });
};

/**
 * Productos con al menos una variante en stock <= minStock.
 * Devuelve un array de productos con sus variantes en bajo stock.
 */
productSchema.statics.getLowStockProducts = async function (options = {}) {
  const { partnerId, limit = 50 } = options;
  const match = { isActive: true };
  if (partnerId) match.partnerId = partnerId;

  const pipeline = [
    { $match: match },
    { $unwind: '$variants' },
    { $match: { $expr: { $lte: ['$variants.stock', '$variants.minStock'] } } },
    {
      $group: {
        _id: '$_id',
        name: { $first: '$name' },
        categoryId: { $first: '$categoryId' },
        supplierId: { $first: '$supplierId' },
        partnerId: { $first: '$partnerId' },
        price: { $first: '$price' },
        lowStockVariants: { $push: '$variants' },
      },
    },
    { $sort: { name: 1 } },
    { $limit: Math.min(Number(limit) || 50, 200) },
  ];

  return this.aggregate(pipeline);
};

module.exports = mongoose.model('Product', productSchema);