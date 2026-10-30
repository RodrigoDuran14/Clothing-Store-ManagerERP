const mongoose = require('mongoose');
const AppError = require('../utils/AppError');

const TAX_CONDITIONS = [
  'Responsable Inscripto',
  'Monotributista',
  'Exento',
  'Consumidor Final',
  'No Categorizado',
];

const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      maxlength: [100, 'El nombre no puede superar los 100 caracteres'],
    },
    contactName: {
      type: String,
      trim: true,
      maxlength: [100, 'El nombre de contacto no puede superar los 100 caracteres'],
    },
    phone: { type: String, trim: true, maxlength: 30 },
    phone2: { type: String, trim: true, maxlength: 30 },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Email inválido'],
    },
    address: {
      type: String,
      trim: true,
      maxlength: [300, 'La dirección no puede superar los 300 caracteres'],
    },
    taxId: { type: String, trim: true, maxlength: 30 },
    taxCondition: {
      type: String,
      enum: {
        values: TAX_CONDITIONS,
        message: `Condición fiscal inválida. Valores permitidos: ${TAX_CONDITIONS.join(', ')}`,
      },
      default: 'No Categorizado',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [2000, 'Las notas no pueden superar los 2000 caracteres'],
    },
    suppliedProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    isActive: { type: Boolean, default: true },
    rating: {
      type: Number,
      min: [1, 'La calificación mínima es 1'],
      max: [5, 'La calificación máxima es 5'],
      default: 3,
    },
    deliveryTime: {
      type: Number,
      min: [0, 'El tiempo de entrega no puede ser negativo'],
      default: 0,
    },
    paymentTerms: {
      type: String,
      trim: true,
      maxlength: [100, 'Las condiciones de pago no pueden superar los 100 caracteres'],
    },
    bankInfo: {
      bank: { type: String, trim: true, maxlength: 100 },
      accountType: { type: String, trim: true, maxlength: 50 },
      accountNumber: { type: String, trim: true, maxlength: 50 },
      cbu: { type: String, trim: true, maxlength: 30 },
      alias: { type: String, trim: true, maxlength: 50 },
      holderName: { type: String, trim: true, maxlength: 100 },
    },
    lastPurchase: { type: Date, default: null },
    totalPurchases: { type: Number, default: 0, min: 0 },
    debt: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* =========================================================
 *  Índices
 *  - name único case-insensitive (collation es)
 *  - taxId indexado (búsqueda de facturación)
 *  - suppliedProducts indexado (lookups inversos)
 * ========================================================= */
supplierSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'es', strength: 2 } }
);
supplierSchema.index({ taxId: 1 });
supplierSchema.index({ isActive: 1, rating: -1 });
supplierSchema.index({ suppliedProducts: 1 });
supplierSchema.index({ debt: -1 });

/* =========================================================
 *  Virtuals
 * ========================================================= */
supplierSchema.virtual('hasDebt').get(function () {
  return this.debt > 0;
});

supplierSchema.virtual('isActiveSupplier').get(function () {
  return this.isActive;
});

/* =========================================================
 *  Métodos de instancia
 * ========================================================= */

/**
 * Agrega un producto a la lista de productos suministrados.
 * Idempotente: si el producto ya está, no hace nada.
 */
supplierSchema.methods.addProduct = async function (productId) {
  if (!productId) {
    throw new AppError('Se requiere un ID de producto', 400);
  }
  const idStr = productId.toString();
  const alreadyLinked = this.suppliedProducts.some(
    (p) => p.toString() === idStr
  );
  if (alreadyLinked) return this;

  this.suppliedProducts.push(productId);
  return this.save();
};

/**
 * Quita un producto de la lista de productos suministrados.
 * Idempotente: si el producto no está, no hace nada.
 */
supplierSchema.methods.removeProduct = async function (productId) {
  if (!productId) {
    throw new AppError('Se requiere un ID de producto', 400);
  }
  const idStr = productId.toString();
  const before = this.suppliedProducts.length;
  this.suppliedProducts = this.suppliedProducts.filter(
    (p) => p.toString() !== idStr
  );
  if (this.suppliedProducts.length === before) return this;
  return this.save();
};

/**
 * Registra una compra al proveedor.
 * - Incrementa el contador de compras
 * - Actualiza lastPurchase
 * - Aumenta la deuda por la diferencia no pagada (amount - paid)
 *
 * @param {number} amount   Monto total de la compra
 * @param {number} paid     Monto abonado en el momento (default 0)
 */
supplierSchema.methods.recordPurchase = async function (amount, paid = 0) {
  const amountNum = Number(amount);
  const paidNum = Number(paid);

  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new AppError('El monto de la compra debe ser mayor a cero', 400);
  }
  if (!Number.isFinite(paidNum) || paidNum < 0) {
    throw new AppError('El monto abonado no puede ser negativo', 400);
  }
  if (paidNum > amountNum) {
    throw new AppError('El monto abonado no puede superar el total', 400);
  }

  this.totalPurchases += 1;
  this.lastPurchase = new Date();
  this.debt = (this.debt || 0) + (amountNum - paidNum);

  return this.save();
};

/**
 * Ajusta la deuda del proveedor.
 * - amount > 0 → aumenta deuda (nueva compra a cuenta)
 * - amount < 0 → reduce deuda (pago)
 *
 * No permite que la deuda resultante sea negativa.
 */
supplierSchema.methods.updateDebt = async function (amount) {
  const amountNum = Number(amount);

  if (!Number.isFinite(amountNum) || amountNum === 0) {
    throw new AppError('El ajuste de deuda debe ser distinto de cero', 400);
  }

  const newDebt = (this.debt || 0) + amountNum;
  if (newDebt < 0) {
    throw new AppError(
      `El ajuste dejaría la deuda en negativo (deuda actual: $${this.debt})`,
      400
    );
  }

  this.debt = newDebt;
  return this.save();
};

/* =========================================================
 *  Statics
 * ========================================================= */

/**
 * Top proveedores activos según el criterio indicado.
 * @param {number} limit
 * @param {'rating'|'purchases'|'debt'} sortBy
 */
supplierSchema.statics.getTopSuppliers = async function (
  limit = 5,
  sortBy = 'rating'
) {
  const sortMap = {
    rating: { rating: -1, totalPurchases: -1 },
    purchases: { totalPurchases: -1, rating: -1 },
    debt: { debt: -1, rating: -1 },
  };
  const sort = sortMap[sortBy] || sortMap.rating;

  return this.find({ isActive: true })
    .sort(sort)
    .limit(Math.min(Number(limit) || 5, 50))
    .lean();
};

/**
 * Proveedores activos que suministran un producto determinado,
 * ordenados por calificación descendente.
 */
supplierSchema.statics.findByProduct = async function (productId) {
  return this.find({
    suppliedProducts: productId,
    isActive: true,
  })
    .sort({ rating: -1, name: 1 })
    .lean();
};

module.exports = mongoose.model('Supplier', supplierSchema);
module.exports.TAX_CONDITIONS = TAX_CONDITIONS;