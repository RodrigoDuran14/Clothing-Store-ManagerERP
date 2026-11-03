const crypto = require('crypto');
const mongoose = require('mongoose');
const AppError = require('../utils/AppError');

const VOUCHER_TYPES = ['return_credit', 'gift', 'promotion', 'compensation'];
const VOUCHER_STATUSES = ['active', 'redeemed', 'expired', 'cancelled'];
const VOUCHER_ORIGINS = ['return', 'manual', 'promotion', 'campaign'];
const VOUCHER_CHANNELS = ['pos', 'ecommerce'];

const PREFIX_MAP = {
  return_credit: 'VCH',
  gift: 'GIFT',
  promotion: 'PROMO',
  compensation: 'COMP',
};

/* =========================================================
 *  Subdocumentos
 * ========================================================= */
const redemptionSchema = new mongoose.Schema(
  {
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    redeemedAt: { type: Date, default: Date.now },
    redeemedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

/* =========================================================
 *  Schema principal
 * ========================================================= */
const voucherSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9-]+$/, 'El código solo puede contener letras, números y guiones'],
    },
    type: {
      type: String,
      enum: { values: VOUCHER_TYPES, message: 'Tipo de voucher inválido' },
      required: true,
    },
    origin: { type: String, enum: VOUCHER_ORIGINS, default: 'manual' },

    /* ---------- Monto ---------- */
    originalAmount: { type: Number, required: true, min: 0.01 },
    remainingAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'ARS', uppercase: true },

    /* ---------- Restricciones ---------- */
    minimumPurchase: { type: Number, default: 0, min: 0 },
    applicableCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    applicableProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    applicableChannels: [{ type: String, enum: VOUCHER_CHANNELS }],
    isStackable: { type: Boolean, default: false },
    maxUses: { type: Number, default: 1, min: 1 },

    /* ---------- Vigencia ---------- */
    expiresAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    status: {
      type: String,
      enum: { values: VOUCHER_STATUSES, message: 'Estado de voucher inválido' },
      default: 'active',
    },

    /* ---------- Ownership ---------- */
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    issuedTo: { type: String, trim: true, maxlength: 200, default: null },

    /* ---------- Vinculación ---------- */
    returnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Return', default: null },
    issuedSaleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },

    /* ---------- Redenciones ---------- */
    redemptions: { type: [redemptionSchema], default: [] },
    usageCount: { type: Number, default: 0, min: 0 },

    /* ---------- Metadata ---------- */
    notes: { type: String, trim: true, maxlength: 500, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, maxlength: 300, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/* =========================================================
 *  Índices
 * ========================================================= */
voucherSchema.index({ code: 1 }, { unique: true });
voucherSchema.index({ clientId: 1, status: 1 });
voucherSchema.index({ status: 1, expiresAt: 1 });
voucherSchema.index({ type: 1, status: 1 });
voucherSchema.index({ returnId: 1 }, { sparse: true });
voucherSchema.index({ createdAt: -1 });

/* =========================================================
 *  Virtuals
 * ========================================================= */
voucherSchema.virtual('isExpired').get(function () {
  return this.expiresAt ? new Date() > this.expiresAt : false;
});

voucherSchema.virtual('isRedeemable').get(function () {
  return (
    this.isActive &&
    this.status === 'active' &&
    this.remainingAmount > 0 &&
    !this.isExpired
  );
});

voucherSchema.virtual('usedPercentage').get(function () {
  if (!this.originalAmount) return 0;
  return Number(
    (((this.originalAmount - this.remainingAmount) / this.originalAmount) * 100).toFixed(2)
  );
});

/* =========================================================
 *  pre('save'): generar código único si no viene
 * ========================================================= */
voucherSchema.pre('save', async function (next) {
  if (!this.isNew || this.code) return next();
  try {
    const prefix = PREFIX_MAP[this.type] || 'VCH';
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const exists = await this.constructor.findOne({ code }).select('_id').lean();
      if (!exists) {
        this.code = code;
        return next();
      }
    }
    return next(new AppError('No se pudo generar un código único de voucher', 500));
  } catch (err) {
    next(err);
  }
});

/* =========================================================
 *  Métodos
 * ========================================================= */

/**
 * ¿Este voucher se puede aplicar a una venta con el contexto dado?
 * Read-only, no modifica nada. Devuelve { ok, reason, ... }.
 */
voucherSchema.methods.canBeUsedOn = function (saleContext) {
  const { total, channel, clientId, productIds = [], categoryIds = [] } = saleContext;

  if (!this.isRedeemable) {
    let reason = 'not-redeemable';
    if (this.isExpired) reason = 'expired';
    else if (this.status !== 'active') reason = `status-${this.status}`;
    else if (this.remainingAmount <= 0) reason = 'no-balance';
    else if (!this.isActive) reason = 'inactive';
    return { ok: false, reason };
  }

  if (this.usageCount >= this.maxUses) {
    return { ok: false, reason: 'max-uses-reached' };
  }

  if (total < this.minimumPurchase) {
    return {
      ok: false,
      reason: 'below-minimum-purchase',
      required: this.minimumPurchase,
      current: total,
    };
  }

  if (this.applicableChannels.length > 0 && channel && !this.applicableChannels.includes(channel)) {
    return {
      ok: false,
      reason: 'channel-not-allowed',
      allowed: this.applicableChannels,
    };
  }

  if (this.clientId && clientId && !this.clientId.equals(clientId)) {
    return { ok: false, reason: 'belongs-to-other-client' };
  }

  if (this.applicableProducts.length > 0) {
    const hasProduct = productIds.some((pid) =>
      this.applicableProducts.some((ap) => ap.equals(pid))
    );
    if (!hasProduct) return { ok: false, reason: 'product-not-applicable' };
  }

  if (this.applicableCategories.length > 0) {
    const hasCategory = categoryIds.some((cid) =>
      this.applicableCategories.some((ac) => ac.equals(cid))
    );
    if (!hasCategory) return { ok: false, reason: 'category-not-applicable' };
  }

  return { ok: true, maxUsable: this.remainingAmount };
};

/**
 * Registra una redención. No persiste — el caller hace `save()`.
 */
voucherSchema.methods.addRedemption = function (saleId, amount, userId) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError('El monto a redimir debe ser positivo', 400);
  }
  if (amt > this.remainingAmount + 0.01) {
    throw new AppError(
      `El monto ($${amt}) supera el saldo disponible del voucher ($${this.remainingAmount})`,
      400
    );
  }

  this.redemptions.push({
    saleId,
    amount: amt,
    redeemedBy: userId,
    redeemedAt: new Date(),
  });
  this.remainingAmount = Number((this.remainingAmount - amt).toFixed(2));
  this.usageCount += 1;

  if (this.remainingAmount === 0 || this.usageCount >= this.maxUses) {
    this.status = 'redeemed';
  }
  return this;
};

voucherSchema.methods.cancel = function (userId, reason) {
  if (this.status === 'redeemed') {
    throw new AppError('No se puede cancelar un voucher ya redimido', 400);
  }
  if (this.status === 'cancelled') {
    throw new AppError('El voucher ya está cancelado', 400);
  }
  this.status = 'cancelled';
  this.isActive = false;
  this.cancelledBy = userId;
  this.cancelledAt = new Date();
  this.cancellationReason = reason || 'Cancelado por el administrador';
  return this;
};

/* =========================================================
 *  Statics
 * ========================================================= */
voucherSchema.statics.findActiveByCode = function (code) {
  return this.findOne({ code: String(code).toUpperCase(), status: 'active' });
};

voucherSchema.statics.findByClient = function (clientId, options = {}) {
  const filter = { clientId };
  if (options.status) filter.status = options.status;
  else filter.status = 'active';
  return this.find(filter).sort({ expiresAt: 1, createdAt: -1 });
};

module.exports = mongoose.model('Voucher', voucherSchema);
module.exports.VOUCHER_TYPES = VOUCHER_TYPES;
module.exports.VOUCHER_STATUSES = VOUCHER_STATUSES;
module.exports.VOUCHER_ORIGINS = VOUCHER_ORIGINS;
module.exports.VOUCHER_CHANNELS = VOUCHER_CHANNELS;
module.exports.PREFIX_MAP = PREFIX_MAP;