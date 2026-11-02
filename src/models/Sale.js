const mongoose = require('mongoose');
const AppError = require('../utils/AppError');

const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'credit', 'other'];
const PAYMENT_STATUSES = ['pending', 'partial', 'paid'];
const SALE_STATUSES = ['pending', 'completed', 'cancelled', 'refunded', 'partially_refunded'];
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const CHANNELS = ['pos', 'ecommerce'];
const DISCOUNT_TYPES = ['amount', 'percentage'];

/* =========================================================
 *  Subdocumentos
 * ========================================================= */
const saleItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, trim: true },
    productSku: { type: String, required: true, trim: true, uppercase: true },
    size: { type: String, required: true, trim: true, uppercase: true },
    color: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
  },
  { _id: true }
);

const paymentSchema = new mongoose.Schema(
  {
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: Date, default: Date.now },
    bankAccountId: { type: mongoose.Schema.Types.ObjectId, default: null },
    reference: { type: String, trim: true, maxlength: 100, default: null },
    installments: { type: Number, default: 1, min: 1 },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: true }
);

/* tracking de devoluciones por item */
const returnedItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    size: { type: String, required: true, uppercase: true },
    color: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

/* =========================================================
 *  Schema principal
 * ========================================================= */
const saleSchema = new mongoose.Schema(
  {
    saleNumber: { type: String, required: true, unique: true, trim: true },

    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    items: { type: [saleItemSchema], default: [] },

    subtotal: { type: Number, required: true, min: 0 },
    discountType: { type: String, enum: DISCOUNT_TYPES, default: 'amount' },
    discountValue: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 21, min: 0, max: 100 },
    taxAmount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'ARS', uppercase: true },

    payments: { type: [paymentSchema], default: [] },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },

    status: { type: String, enum: SALE_STATUSES, default: 'pending' },
    orderStatus: { type: String, enum: ORDER_STATUSES, default: 'pending' },
    channel: { type: String, enum: CHANNELS, default: 'pos' },

    notes: { type: String, trim: true, maxlength: 1000, default: null },
    cancellationReason: { type: String, trim: true, maxlength: 500, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },

    /* tracking de devoluciones */
    hasReturns: { type: Boolean, default: false },
    returnsCount: { type: Number, default: 0, min: 0 },
    returnedTotal: { type: Number, default: 0, min: 0 },
    returnedItems: { type: [returnedItemSchema], default: [] },

    /* si esta venta nació de un exchange */
    originalSaleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
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
saleSchema.index({ saleNumber: 1 }, { unique: true });
saleSchema.index({ createdAt: -1 });
saleSchema.index({ clientId: 1, createdAt: -1 });
saleSchema.index({ sellerId: 1, createdAt: -1 });
saleSchema.index({ status: 1, createdAt: -1 });
saleSchema.index({ paymentStatus: 1 });
saleSchema.index({ channel: 1, createdAt: -1 });
saleSchema.index({ 'items.productId': 1 });
saleSchema.index({ 'items.partnerId': 1 });
saleSchema.index({ hasReturns: 1, createdAt: -1 });
saleSchema.index({ originalSaleId: 1 }, { sparse: true });

/* =========================================================
 *  Virtuals
 * ========================================================= */
saleSchema.virtual('paidAmount').get(function () {
  return (this.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
});

saleSchema.virtual('pendingBalance').get(function () {
  return Math.max(0, Number((this.total - this.paidAmount).toFixed(2)));
});

saleSchema.virtual('paymentPercentage').get(function () {
  if (!this.total || this.total <= 0) return 0;
  return Number(Math.min(100, (this.paidAmount / this.total) * 100).toFixed(2));
});

saleSchema.virtual('itemCount').get(function () {
  return (this.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
});

saleSchema.virtual('returnableAmount').get(function () {
  return Math.max(0, Number((this.total - (this.returnedTotal || 0)).toFixed(2)));
});

/* =========================================================
 *  pre('save'): generar saleNumber único por mes
 * ========================================================= */
saleSchema.pre('save', async function (next) {
  if (!this.isNew || this.saleNumber) return next();
  try {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    for (let attempt = 0; attempt < 10; attempt++) {
      const count = await this.constructor.countDocuments({
        createdAt: { $gte: monthStart },
      });
      const candidate = `S-${yyyymm}-${String(count + 1 + attempt).padStart(4, '0')}`;
      const exists = await this.constructor.findOne({ saleNumber: candidate }).select('_id').lean();
      if (!exists) {
        this.saleNumber = candidate;
        return next();
      }
    }
    return next(new AppError('No se pudo generar el número de venta', 500));
  } catch (err) {
    next(err);
  }
});

/* =========================================================
 *  Métodos
 * ========================================================= */

saleSchema.methods.addPayment = function (paymentData) {
  if (['cancelled', 'refunded'].includes(this.status)) {
    throw new AppError('No se puede agregar pagos a una venta cancelada o reembolsada', 400);
  }
  if (!PAYMENT_METHODS.includes(paymentData.method)) {
    throw new AppError(`Método de pago inválido: ${paymentData.method}`, 400);
  }

  const amt = Number(paymentData.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError('El monto del pago debe ser positivo', 400);
  }

  const newPaid = this.paidAmount + amt;
  if (newPaid > this.total + 0.01) {
    throw new AppError(
      `El pago ($${amt}) excede el saldo pendiente ($${this.pendingBalance})`,
      400
    );
  }

  this.payments.push({ ...paymentData, amount: amt, date: new Date() });

  if (newPaid >= this.total - 0.01) {
    this.paymentStatus = 'paid';
    if (this.status === 'pending') {
      this.status = 'completed';
      this.completedAt = new Date();
    }
  } else if (newPaid > 0) {
    this.paymentStatus = 'partial';
  }

  return this;
};

/**
 * solo las ventas pendientes se pueden cancelar.
 * Las ventas completadas van por el Módulo 8 (devoluciones).
 */
saleSchema.methods.canCancel = function () {
  return this.status === 'pending';
};

saleSchema.methods.canReturn = function () {
  return (
    ['completed', 'partially_refunded'].includes(this.status) &&
    this.paymentStatus === 'paid'
  );
};

saleSchema.methods.changeStatus = function (newStatus, options = {}) {
  const allowed = {
    pending: ['completed', 'cancelled'],
    completed: ['refunded', 'partially_refunded'],
    cancelled: [],
    refunded: [],
    partially_refunded: ['refunded'],
  };
  if (!allowed[this.status] || !allowed[this.status].includes(newStatus)) {
    throw new AppError(
      `Transición inválida: '${this.status}' → '${newStatus}'`,
      400
    );
  }

  this.status = newStatus;
  if (newStatus === 'completed') this.completedAt = new Date();

  if (newStatus === 'cancelled') {
    this.cancellationReason = options.reason || 'Cancelada sin motivo especificado';
    this.cancelledAt = new Date();
    this.cancelledBy = options.cancelledBy || null;
    this.orderStatus = 'cancelled';
  }
  if (['refunded', 'partially_refunded'].includes(newStatus)) {
    this.cancelledAt = new Date();
    this.cancelledBy = options.cancelledBy || null;
  }

  return this;
};

/**
 * ¿cuántas unidades quedan disponibles para devolver de un item?
 * O(1) — no hace queries, todo vive en el documento.
 */
saleSchema.methods.getRemainingReturnable = function (productId, size, color) {
  const normSize = String(size).toUpperCase();
  const original = (this.items || []).find(
    (i) =>
      i.productId.equals(productId) &&
      i.size === normSize &&
      i.color === color
  );
  if (!original) return { original: 0, returned: 0, available: 0 };

  const returned = (this.returnedItems || [])
    .filter(
      (r) =>
        r.productId.equals(productId) &&
        r.size === normSize &&
        r.color === color
    )
    .reduce((s, r) => s + r.quantity, 0);

  return {
    original: original.quantity,
    returned,
    available: original.quantity - returned,
  };
};

/**
 * ¿la venta ya fue devuelta por completo (por monto)?
 */
saleSchema.methods.isFullyReturned = function () {
  return (this.returnedTotal || 0) >= this.total - 0.01;
};

/* =========================================================
 *  Statics
 * ========================================================= */
saleSchema.statics.getSalesByPeriod = function (from, to, options = {}) {
  const filter = { createdAt: { $gte: new Date(from), $lte: new Date(to) } };
  if (options.status) filter.status = options.status;
  if (options.channel) filter.channel = options.channel;
  if (options.clientId) filter.clientId = options.clientId;
  if (options.sellerId) filter.sellerId = options.sellerId;
  if (options.partnerId) filter['items.partnerId'] = options.partnerId;
  if (options.hasReturns !== undefined) filter.hasReturns = options.hasReturns;

  return this.find(filter).sort({ createdAt: -1 }).limit(options.limit || 100);
};

saleSchema.statics.getTotalByPeriod = async function (from, to, options = {}) {
  const filter = {
    createdAt: { $gte: new Date(from), $lte: new Date(to) },
    status: { $in: ['completed', 'pending', 'partially_refunded'] },
  };
  if (options.channel) filter.channel = options.channel;
  if (options.partnerId) filter['items.partnerId'] = options.partnerId;

  const [agg] = await this.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        salesCount: { $sum: 1 },
        totalRevenue: { $sum: '$total' },
        totalSubtotal: { $sum: '$subtotal' },
        totalTax: { $sum: '$taxAmount' },
        totalDiscount: { $sum: '$discountAmount' },
        totalReturned: { $sum: '$returnedTotal' },        // 👈 NUEVO
        netRevenue: { $sum: { $subtract: ['$total', '$returnedTotal'] } }, // 👈 NUEVO
      },
    },
  ]);

  return agg || {
    salesCount: 0,
    totalRevenue: 0,
    totalSubtotal: 0,
    totalTax: 0,
    totalDiscount: 0,
    totalReturned: 0,
    netRevenue: 0,
  };
};

saleSchema.statics.getTopProducts = function (from, to, limit = 10, options = {}) {
  const match = {
    createdAt: { $gte: new Date(from), $lte: new Date(to) },
    status: { $in: ['completed', 'pending', 'partially_refunded'] },
  };
  if (options.channel) match.channel = options.channel;

  return this.aggregate([
    { $match: match },
    { $unwind: '$items' },
    { $match: options.partnerId ? { 'items.partnerId': options.partnerId } : {} },
    {
      $group: {
        _id: '$items.productId',
        productName: { $first: '$items.productName' },
        productSku: { $first: '$items.productSku' },
        totalQuantity: { $sum: '$items.quantity' },
        totalRevenue: { $sum: '$items.subtotal' },
        salesCount: { $sum: 1 },
      },
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: limit },
  ]);
};

module.exports = mongoose.model('Sale', saleSchema);
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
module.exports.SALE_STATUSES = SALE_STATUSES;
module.exports.ORDER_STATUSES = ORDER_STATUSES;
module.exports.CHANNELS = CHANNELS;
module.exports.DISCOUNT_TYPES = DISCOUNT_TYPES;