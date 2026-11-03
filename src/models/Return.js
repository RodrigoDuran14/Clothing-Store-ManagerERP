const mongoose = require('mongoose');
const AppError = require('../utils/AppError');

const RETURN_TYPES = ['refund', 'exchange'];
const RETURN_STATUSES = ['pending', 'approved', 'rejected', 'completed', 'cancelled'];
const REFUND_METHODS = ['cash', 'transfer', 'card', 'credit_account', 'voucher'];
const REASON_TYPES = [
  'wrong-size',
  'wrong-color',
  'defective',
  'not-as-described',
  'changed-mind',
  'other',
];

/* =========================================================
 *  Subdocumentos
 * ========================================================= */
const returnItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    productSku: { type: String, required: true, uppercase: true },
    size: { type: String, required: true, uppercase: true },
    color: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
  },
  { _id: false }
);

const trackingEventSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, trim: true, maxlength: 500, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const partnerAdjustmentSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    splitId: { type: mongoose.Schema.Types.ObjectId, ref: 'PartnerSplit', required: true },
    reversedAmount: { type: Number, default: 0 },        // descuento del split original
    newSplitId: { type: mongoose.Schema.Types.ObjectId, ref: 'PartnerSplit', default: null },
  },
  { _id: false }
);

const refundDetailsSchema = new mongoose.Schema(
  {
    method: { type: String, enum: REFUND_METHODS, default: null },
    amount: { type: Number, default: 0, min: 0 },
    reference: { type: String, trim: true, maxlength: 100, default: null },
    voucherCode: { type: String, trim: true, uppercase: true, default: null },
    voucherExpiresAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

const commissionReversalSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', default: null },
    reversedAmount: { type: Number, default: 0 },   // comisión revertida de la venta original
    newCommission: { type: Number, default: 0 },    // comisión generada por el exchange
    netAmount: { type: Number, default: 0 },        // newCommission - reversedAmount
  },
  { _id: false }
);

/* =========================================================
 *  Schema principal
 * ========================================================= */
const returnSchema = new mongoose.Schema(
  {
    returnNumber: { type: String, required: true, unique: true, trim: true },

    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true },
    saleNumber: { type: String, required: true },

    // Si es exchange: la venta nueva que se genera al procesar
    exchangeSaleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
    exchangeSaleNumber: { type: String, default: null },

    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },

    type: { type: String, enum: RETURN_TYPES, required: true },
    status: { type: String, enum: RETURN_STATUSES, default: 'pending' },

    /* ---------- Items devueltos ---------- */
    items: { type: [returnItemSchema], default: [] },
    refundSubtotal: { type: Number, required: true, min: 0 },
    refundTax: { type: Number, required: true, min: 0 },
    refundTotal: { type: Number, required: true, min: 0 },

    /* ---------- Items del exchange ---------- */
    exchangeItems: { type: [returnItemSchema], default: [] },
    exchangeSubtotal: { type: Number, default: 0, min: 0 },
    exchangeTax: { type: Number, default: 0, min: 0 },
    exchangeTotal: { type: Number, default: 0, min: 0 },

    /* ---------- Balance ---------- */
    // > 0 cliente debe pagar | < 0 tienda devuelve | 0 sin diferencia
    balanceDue: { type: Number, default: 0 },
    balancePaymentMethod: { type: String, enum: REFUND_METHODS, default: null },
    balancePaymentReference: { type: String, trim: true, maxlength: 100, default: null },

    /* ---------- Refund ---------- */
    refundMethod: { type: String, enum: REFUND_METHODS, default: null },
    refundDetails: { type: refundDetailsSchema, default: () => ({}) },

    /* ---------- Motivo ---------- */
    reasonType: { type: String, enum: REASON_TYPES, default: 'other' },
    reason: { type: String, trim: true, maxlength: 500 },
    clientNotes: { type: String, trim: true, maxlength: 1000, default: null },
    adminNotes: { type: String, trim: true, maxlength: 1000, default: null },

    /* ---------- Flujo de aprobación ---------- */
    approval: {
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      approvedAt: { type: Date, default: null },
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      rejectedAt: { type: Date, default: null },
      rejectionReason: { type: String, trim: true, maxlength: 500, default: null },
    },

    /* ---------- Procesamiento ---------- */
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    processedAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, maxlength: 500, default: null },

    /* ---------- Trazabilidad ---------- */
    tracking: { type: [trackingEventSchema], default: [] },
    partnerAdjustments: { type: [partnerAdjustmentSchema], default: [] },
    commissionReversal: { type: commissionReversalSchema, default: () => ({}) },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/* =========================================================
 *  Índices
 * ========================================================= */
returnSchema.index({ returnNumber: 1 }, { unique: true });
returnSchema.index({ saleId: 1, createdAt: -1 });
returnSchema.index({ exchangeSaleId: 1 }, { sparse: true });
returnSchema.index({ clientId: 1, createdAt: -1 });
returnSchema.index({ type: 1, status: 1, createdAt: -1 });
returnSchema.index({ 'items.partnerId': 1, createdAt: -1 });
returnSchema.index({ createdAt: -1 });

/* =========================================================
 *  Virtuals
 * ========================================================= */
returnSchema.virtual('totalRefund').get(function () {
  return this.refundTotal;
});

returnSchema.virtual('isExchange').get(function () {
  return this.type === 'exchange';
});

returnSchema.virtual('daysOpen').get(function () {
  const ref = this.processedAt || this.cancelledAt || new Date();
  return Math.floor((ref - this.createdAt) / (24 * 60 * 60 * 1000));
});

returnSchema.virtual('netEffectForStore').get(function () {
  // positivo = tienda gana, negativo = tienda pierde
  return Number((this.balanceDue).toFixed(2));
});

/* =========================================================
 *  pre('save'): generar returnNumber por mes
 *  Formato: R-YYYYMM-####
 * ========================================================= */
returnSchema.pre('save', async function (next) {
  if (!this.isNew || this.returnNumber) return next();
  try {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    for (let attempt = 0; attempt < 10; attempt++) {
      const count = await this.constructor.countDocuments({
        createdAt: { $gte: monthStart },
      });
      const candidate = `R-${yyyymm}-${String(count + 1 + attempt).padStart(4, '0')}`;
      const exists = await this.constructor
        .findOne({ returnNumber: candidate })
        .select('_id')
        .lean();
      if (!exists) {
        this.returnNumber = candidate;
        return next();
      }
    }
    return next(new AppError('No se pudo generar el número de devolución', 500));
  } catch (err) {
    next(err);
  }
});

/* =========================================================
 *  Métodos
 * ========================================================= */

returnSchema.methods.addTracking = function (action, userId, note = null) {
  this.tracking.push({ action, by: userId || null, note });
  return this;
};

returnSchema.methods.canApprove = function () {
  return this.status === 'pending';
};

returnSchema.methods.canReject = function () {
  return this.status === 'pending';
};

returnSchema.methods.canProcess = function () {
  return this.status === 'approved';
};

returnSchema.methods.canCancel = function () {
  return ['pending', 'approved'].includes(this.status);
};

returnSchema.methods.approve = function (userId, notes = null) {
  if (!this.canApprove()) {
    throw new AppError(`No se puede aprobar una devolución en estado '${this.status}'`, 400);
  }
  this.status = 'approved';
  this.approval.approvedBy = userId;
  this.approval.approvedAt = new Date();
  if (notes) this.adminNotes = notes;
  this.addTracking('approved', userId, notes);
  return this;
};

returnSchema.methods.reject = function (userId, rejectionReason) {
  if (!this.canReject()) {
    throw new AppError(`No se puede rechazar una devolución en estado '${this.status}'`, 400);
  }
  if (!rejectionReason || rejectionReason.trim().length === 0) {
    throw new AppError('Se requiere un motivo de rechazo', 400);
  }
  this.status = 'rejected';
  this.approval.rejectedBy = userId;
  this.approval.rejectedAt = new Date();
  this.approval.rejectionReason = rejectionReason;
  this.addTracking('rejected', userId, rejectionReason);
  return this;
};

returnSchema.methods.cancel = function (userId, reason = null) {
  if (!this.canCancel()) {
    throw new AppError(`No se puede cancelar una devolución en estado '${this.status}'`, 400);
  }
  this.status = 'cancelled';
  this.cancelledBy = userId;
  this.cancelledAt = new Date();
  this.cancellationReason = reason || 'Cancelada por el administrador';
  this.addTracking('cancelled', userId, reason);
  return this;
};

returnSchema.methods.complete = function (userId, payload = {}) {
  if (this.status !== 'approved') {
    throw new AppError(
      `Solo se puede completar una devolución aprobada (estado actual: '${this.status}')`,
      400
    );
  }
  this.status = 'completed';
  this.processedBy = userId;
  this.processedAt = new Date();

  if (payload.exchangeSaleId) {
    this.exchangeSaleId = payload.exchangeSaleId;
    this.exchangeSaleNumber = payload.exchangeSaleNumber;
  }
  if (payload.refundDetails) {
    this.refundDetails = { ...this.refundDetails, ...payload.refundDetails };
    this.refundMethod = payload.refundDetails.method || this.refundMethod;
  }
  if (payload.commissionReversal) {
    this.commissionReversal = payload.commissionReversal;
  }
  if (payload.partnerAdjustments) {
    this.partnerAdjustments = payload.partnerAdjustments;
  }

  this.addTracking('completed', userId);
  return this;
};

/* =========================================================
 *  Statics
 * ========================================================= */
returnSchema.statics.getByPeriod = function (from, to, options = {}) {
  const filter = { createdAt: { $gte: new Date(from), $lte: new Date(to) } };
  if (options.type) filter.type = options.type;
  if (options.status) filter.status = options.status;
  if (options.clientId) filter.clientId = options.clientId;
  if (options.saleId) filter.saleId = options.saleId;
  if (options.partnerId) filter['items.partnerId'] = options.partnerId;

  return this.find(filter).sort({ createdAt: -1 }).limit(options.limit || 100);
};

returnSchema.statics.getReturnStats = async function (from, to) {
  const match = {};
  if (from && to) {
    match.createdAt = { $gte: new Date(from), $lte: new Date(to) };
  }

  const [byStatus, byType, totals] = await Promise.all([
    this.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    this.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalRefund: { $sum: '$refundTotal' },
          totalExchange: { $sum: '$exchangeTotal' },
          netBalance: { $sum: '$balanceDue' },
        },
      },
    ]),
    this.aggregate([
      { $match: { ...match, status: 'completed' } },
      {
        $group: {
          _id: null,
          completedCount: { $sum: 1 },
          totalRefunded: { $sum: '$refundTotal' },
          totalBalanceCollected: {
            $sum: { $cond: [{ $gt: ['$balanceDue', 0] }, '$balanceDue', 0] },
          },
          totalBalanceRefunded: {
            $sum: {
              $cond: [{ $lt: ['$balanceDue', 0] }, { $abs: '$balanceDue' }, 0],
            },
          },
        },
      },
    ]),
  ]);

  const statusMap = byStatus.reduce((acc, r) => {
    acc[r._id] = r.count;
    return acc;
  }, {});
  const typeMap = byType.reduce((acc, r) => {
    acc[r._id] = {
      count: r.count,
      totalRefund: r.totalRefund,
      totalExchange: r.totalExchange,
      netBalance: r.netBalance,
    };
    return acc;
  }, {});
  const t = totals[0] || {
    completedCount: 0,
    totalRefunded: 0,
    totalBalanceCollected: 0,
    totalBalanceRefunded: 0,
  };

  return { byStatus: statusMap, byType: typeMap, totals: t };
};

module.exports = mongoose.model('Return', returnSchema);
module.exports.RETURN_TYPES = RETURN_TYPES;
module.exports.RETURN_STATUSES = RETURN_STATUSES;
module.exports.REFUND_METHODS = REFUND_METHODS;
module.exports.REASON_TYPES = REASON_TYPES;