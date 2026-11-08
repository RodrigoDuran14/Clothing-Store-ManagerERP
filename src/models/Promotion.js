const mongoose = require('mongoose');
const AppError = require('../utils/AppError');

const PROMOTION_TYPES = ['automatic', 'coupon'];
const BENEFIT_TYPES = ['percentage', 'fixed', 'buy_x_get_y'];
const CHANNELS = ['pos', 'ecommerce'];
const CLIENT_CATEGORIES = ['new', 'occasional', 'frequent', 'vip', 'inactive'];

/* =========================================================
 *  Subdocumentos
 * ========================================================= */
const buyXGetYSchema = new mongoose.Schema(
  {
    buyQuantity: { type: Number, required: true, min: 1 },
    getQuantity: { type: Number, required: true, min: 1 },
    discountPercentage: {
      type: Number,
      min: 1,
      max: 100,
      default: 100, // 100 = gratis
    },
  },
  { _id: false }
);

/* =========================================================
 *  Schema principal
 * ========================================================= */
const promotionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      maxlength: [150, 'El nombre no puede superar los 150 caracteres'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'La descripción no puede superar los 1000 caracteres'],
    },
    code: {
      type: String,
      uppercase: true,
      trim: true,
      maxlength: 30,
      default: null,
    },
    type: {
      type: String,
      enum: { values: PROMOTION_TYPES, message: 'Tipo de promoción inválido' },
      required: true,
    },
    priority: {
      type: Number,
      default: 0,
      min: 0,
      max: 1000,
    },

    /* ---------- Beneficios ---------- */
    benefitType: {
      type: String,
      enum: { values: BENEFIT_TYPES, message: 'Tipo de beneficio inválido' },
      required: true,
    },
    benefitValue: {
      type: Number,
      min: 0,
      default: 0, // % o monto, según benefitType
    },
    buyXGetY: { type: buyXGetYSchema, default: null },
    maxDiscountAmount: { type: Number, default: 0, min: 0 }, // 0 = sin cap

    /* ---------- Condiciones ---------- */
    minPurchaseAmount: { type: Number, default: 0, min: 0 },
    applicableChannels: [{ type: String, enum: CHANNELS }],
    applicableClientCategories: [{ type: String, enum: CLIENT_CATEGORIES }],

    /* ---------- Filtros de items ---------- */
    applicableProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    applicableCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    applicableSizes: [{ type: String, uppercase: true, trim: true }],
    applicableColors: [{ type: String, trim: true }],

    /* ---------- Vigencia ---------- */
    startDate: { type: Date, required: true, default: Date.now },
    endDate: { type: Date, default: null }, // null = sin vencimiento
    isActive: { type: Boolean, default: true },

    /* ---------- Límites de uso ---------- */
    usageLimit: { type: Number, default: 0, min: 0 },              // 0 = sin límite
    usageLimitPerCustomer: { type: Number, default: 0, min: 0 },   // 0 = sin límite
    usageCount: { type: Number, default: 0, min: 0 },
    usageByClient: {
      type: Map,
      of: Number,
      default: () => ({}),
    },

    /* ---------- Metadata ---------- */
    isStackable: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/* =========================================================
 *  Índices
 * ========================================================= */
promotionSchema.index({ code: 1 }, { unique: true, sparse: true });
promotionSchema.index({ type: 1, isActive: 1, startDate: 1, endDate: 1 });
promotionSchema.index({ isActive: 1, isFeatured: 1 });
promotionSchema.index({ priority: -1 });
promotionSchema.index({ createdAt: -1 });

/* =========================================================
 *  Virtuals
 * ========================================================= */
promotionSchema.virtual('isCurrentlyActive').get(function () {
  if (!this.isActive) return false;
  const now = new Date();
  if (this.startDate && now < this.startDate) return false;
  if (this.endDate && now > this.endDate) return false;
  return true;
});

promotionSchema.virtual('daysRemaining').get(function () {
  if (!this.endDate) return null;
  const diff = this.endDate.getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
});

promotionSchema.virtual('usagePercentage').get(function () {
  if (!this.usageLimit || this.usageLimit <= 0) return 0;
  return Number(Math.min(100, (this.usageCount / this.usageLimit) * 100).toFixed(2));
});

promotionSchema.virtual('remainingUses').get(function () {
  if (!this.usageLimit || this.usageLimit <= 0) return null; // sin límite
  return Math.max(0, this.usageLimit - this.usageCount);
});

/* =========================================================
 *  pre('save'): normalizar code, validar coherencia
 * ========================================================= */
promotionSchema.pre('save', function (next) {
  // 1. Code solo para cupones
  if (this.type === 'automatic') {
    this.code = null;
  }
  if (this.type === 'coupon' && (!this.code || this.code.trim() === '')) {
    return next(new AppError('Las promociones por cupón requieren un código', 400));
  }

  // 2. Validar coherencia del beneficio
  if (this.benefitType === 'percentage') {
    if (this.benefitValue <= 0 || this.benefitValue > 100) {
      return next(
        new AppError('benefitValue debe estar entre 1 y 100 para tipo percentage', 400)
      );
    }
    this.buyXGetY = null;
  } else if (this.benefitType === 'fixed') {
    if (this.benefitValue <= 0) {
      return next(new AppError('benefitValue debe ser mayor a 0 para tipo fixed', 400));
    }
    this.buyXGetY = null;
  } else if (this.benefitType === 'buy_x_get_y') {
    if (
      !this.buyXGetY ||
      !this.buyXGetY.buyQuantity ||
      !this.buyXGetY.getQuantity
    ) {
      return next(
        new AppError('buyXGetY requiere buyQuantity y getQuantity', 400)
      );
    }
    this.benefitValue = 0;
  }

  // 3. Fechas coherentes
  if (this.startDate && this.endDate && this.endDate <= this.startDate) {
    return next(
      new AppError('endDate debe ser posterior a startDate', 400)
    );
  }

  next();
});

/* =========================================================
 *  Métodos
 * ========================================================= */

/**
 * ¿La promoción es válida para el contexto de venta?
 * Read-only. Devuelve { valid, reason, ... }.
 */
promotionSchema.methods.isValid = function (ctx = {}) {
  if (!this.isCurrentlyActive) {
    let reason = 'inactive';
    if (!this.isActive) reason = 'isActive-false';
    else if (this.startDate && new Date() < this.startDate) reason = 'not-started';
    else if (this.endDate && new Date() > this.endDate) reason = 'expired';
    return { valid: false, reason };
  }

  if (this.usageLimit > 0 && this.usageCount >= this.usageLimit) {
    return { valid: false, reason: 'usage-limit-reached' };
  }

  if (this.usageLimitPerCustomer > 0 && ctx.clientId) {
    const key = ctx.clientId.toString();
    const clientUses = this.usageByClient?.get(key) || 0;
    if (clientUses >= this.usageLimitPerCustomer) {
      return { valid: false, reason: 'per-customer-limit-reached', clientUses };
    }
  }

  if (
    this.applicableChannels.length > 0 &&
    ctx.channel &&
    !this.applicableChannels.includes(ctx.channel)
  ) {
    return { valid: false, reason: 'channel-not-applicable' };
  }

  if (
    this.applicableClientCategories.length > 0 &&
    ctx.clientCategory &&
    !this.applicableClientCategories.includes(ctx.clientCategory)
  ) {
    return { valid: false, reason: 'client-category-not-applicable' };
  }

  if (this.minPurchaseAmount > 0 && ctx.currentTotal !== undefined) {
    if (ctx.currentTotal < this.minPurchaseAmount) {
      return {
        valid: false,
        reason: 'below-minimum-purchase',
        required: this.minPurchaseAmount,
        current: ctx.currentTotal,
      };
    }
  }

  return { valid: true };
};

/**
 * ¿Un item matchea con los filtros de esta promoción?
 */
promotionSchema.methods.itemApplies = function (item) {
  if (this.applicableProducts.length > 0) {
    const pid = String(item.productId);
    if (!this.applicableProducts.some((p) => p.toString() === pid)) return false;
  }
  if (this.applicableCategories.length > 0) {
    if (!item.categoryId) return false;
    const cid = String(item.categoryId);
    if (!this.applicableCategories.some((c) => c.toString() === cid)) return false;
  }
  if (this.applicableSizes.length > 0) {
    if (!this.applicableSizes.includes(String(item.size).toUpperCase())) return false;
  }
  if (this.applicableColors.length > 0) {
    const lc = this.applicableColors.map((c) => c.toLowerCase());
    if (!lc.includes(String(item.color).toLowerCase())) return false;
  }
  return true;
};

/**
 * Calcula el descuento de la promoción sobre el `currentTotal`.
 * Devuelve { amount, freeItems }.
 */
promotionSchema.methods.calculateDiscount = function (currentTotal, items) {
  const total = Number(currentTotal) || 0;
  if (total <= 0) return { amount: 0, freeItems: [] };

  if (this.benefitType === 'percentage') {
    let amount = (total * this.benefitValue) / 100;
    if (this.maxDiscountAmount > 0) amount = Math.min(amount, this.maxDiscountAmount);
    amount = Math.min(amount, total);
    return { amount: Number(amount.toFixed(2)), freeItems: [] };
  }

  if (this.benefitType === 'fixed') {
    let amount = this.benefitValue;
    if (this.maxDiscountAmount > 0) amount = Math.min(amount, this.maxDiscountAmount);
    amount = Math.min(amount, total);
    return { amount: Number(amount.toFixed(2)), freeItems: [] };
  }

  if (this.benefitType === 'buy_x_get_y') {
    const applicableItems = items.filter((i) => this.itemApplies(i));
    if (applicableItems.length === 0) return { amount: 0, freeItems: [] };

    const totalQty = applicableItems.reduce((s, i) => s + i.quantity, 0);
    const setSize = this.buyXGetY.buyQuantity + this.buyXGetY.getQuantity;
    const sets = Math.floor(totalQty / setSize);
    const freeQty = sets * this.buyXGetY.getQuantity;
    if (freeQty === 0) return { amount: 0, freeItems: [] };

    // Los items más baratos son los que se descuentan
    const sorted = [...applicableItems].sort((a, b) => a.unitPrice - b.unitPrice);
    let remaining = freeQty;
    let amount = 0;
    const freeItems = [];

    for (const item of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, item.quantity);
      const itemDiscount =
        take * item.unitPrice * (this.buyXGetY.discountPercentage / 100);
      amount += itemDiscount;
      freeItems.push({
        productId: item.productId,
        size: item.size,
        color: item.color,
        quantity: take,
        discount: Number(itemDiscount.toFixed(2)),
      });
      remaining -= take;
    }

    if (this.maxDiscountAmount > 0) amount = Math.min(amount, this.maxDiscountAmount);
    amount = Math.min(amount, total);

    return { amount: Number(amount.toFixed(2)), freeItems };
  }

  return { amount: 0, freeItems: [] };
};

/* =========================================================
 *  Statics
 * ========================================================= */

/**
 * Promociones automáticas activas para un canal dado.
 */
promotionSchema.statics.getActivePromotions = function (options = {}) {
  const now = new Date();
  const filter = {
    type: 'automatic',
    isActive: true,
    startDate: { $lte: now },
    $or: [{ endDate: null }, { endDate: { $gte: now } }],
  };

  if (options.channel) {
    filter.$and = [
      {
        $or: [
          { applicableChannels: { $size: 0 } },
          { applicableChannels: options.channel },
        ],
      },
    ];
  }

  return this.find(filter).sort({ priority: -1, createdAt: 1 });
};

/**
 * Busca un cupón por código (solo tipo coupon).
 */
promotionSchema.statics.getByCode = function (code) {
  return this.findOne({
    code: String(code).toUpperCase().trim(),
    type: 'coupon',
  });
};

/**
 * ¿Un producto matchea esta promoción? (helper estático)
 */
promotionSchema.statics.productApplies = function (promotion, product) {
  return promotion.itemApplies({
    productId: product._id || product.productId,
    categoryId: product.categoryId,
    size: product.size,
    color: product.color,
  });
};

/**
 * Promociones destacadas para mostrar en home/ecommerce.
 */
promotionSchema.statics.getFeatured = function (limit = 5) {
  const now = new Date();
  return this.find({
    isActive: true,
    isFeatured: true,
    startDate: { $lte: now },
    $or: [{ endDate: null }, { endDate: { $gte: now } }],
  })
    .sort({ priority: -1 })
    .limit(Math.min(limit, 20));
};

module.exports = mongoose.model('Promotion', promotionSchema);
module.exports.PROMOTION_TYPES = PROMOTION_TYPES;
module.exports.BENEFIT_TYPES = BENEFIT_TYPES;
module.exports.CHANNELS = CHANNELS;
module.exports.CLIENT_CATEGORIES = CLIENT_CATEGORIES;