const mongoose = require('mongoose');
const AppError = require('../utils/AppError');

const COMMISSION_TYPES = ['percentage', 'fixed', 'tiered'];
const SELLER_ROLES = ['employee', 'partner']; // admin y customer no venden

/* =========================================================
 *  Subdocumentos
 * ========================================================= */
const shiftSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre del turno es obligatorio'],
      trim: true,
      maxlength: 50,
    },
    // 0=Domingo, 1=Lunes, ..., 6=Sábado (convención JS Date.getDay())
    daysOfWeek: {
      type: [Number],
      validate: {
        validator: (arr) =>
          Array.isArray(arr) &&
          arr.length > 0 &&
          arr.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: 'daysOfWeek debe contener días entre 0 (Domingo) y 6 (Sábado)',
      },
      required: true,
    },
    startTime: {
      type: String,
      required: [true, 'La hora de inicio es obligatoria'],
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora de inicio inválida (HH:MM)'],
    },
    endTime: {
      type: String,
      required: [true, 'La hora de fin es obligatoria'],
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora de fin inválida (HH:MM)'],
    },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

const commissionTierSchema = new mongoose.Schema(
  {
    minAmount: { type: Number, required: true, min: 0 },
    maxAmount: { type: Number, default: null, min: 0 }, // null = sin tope
    rate: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

const commissionEntrySchema = new mongoose.Schema(
  {
    saleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      required: true,
    },
    saleDate: { type: Date, required: true },
    saleAmount: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0, max: 100 },
    amount: { type: Number, required: true, min: 0 },
    period: { type: String, required: true }, // "2026-10"
    paid: { type: Boolean, default: false },
    paidAt: { type: Date, default: null },
    paymentMethod: { type: String, default: null },
    paymentReference: { type: String, default: null },
  },
  { _id: true }
);

/* =========================================================
 *  Schema principal
 * ========================================================= */
const sellerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'El usuario es obligatorio'],
      unique: true, // garantiza 1:1
    },
    // Denormalizado desde User (fuente: rol actual del usuario)
    role: {
      type: String,
      enum: { values: SELLER_ROLES, message: 'Rol de vendedor inválido' },
      required: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    employeeCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 20,
      default: null,
    },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      default: null,
    },

    shifts: { type: [shiftSchema], default: [] },

    // Comisiones (solo aplican si role === 'employee')
    commissionType: {
      type: String,
      enum: { values: COMMISSION_TYPES, message: 'Tipo de comisión inválido' },
      default: 'percentage',
    },
    commissionRate: { type: Number, min: 0, max: 100, default: 0 },
    fixedCommissionAmount: { type: Number, min: 0, default: 0 },
    commissionTiers: { type: [commissionTierSchema], default: [] },

    // Métricas
    salesCount: { type: Number, default: 0, min: 0 },
    totalSales: { type: Number, default: 0, min: 0 },
    totalCommission: { type: Number, default: 0, min: 0 },
    paidCommission: { type: Number, default: 0, min: 0 },
    pendingCommission: { type: Number, default: 0, min: 0 },
    monthlySales: { type: Number, default: 0, min: 0 },
    monthlyCommission: { type: Number, default: 0, min: 0 },
    monthlyResetAt: { type: Date, default: null },
    lastSaleDate: { type: Date, default: null },
    lastCommissionPaymentDate: { type: Date, default: null },

    commissionHistory: { type: [commissionEntrySchema], default: [] },

    notes: { type: String, trim: true, maxlength: 1000, default: null },
    isActive: { type: Boolean, default: true },
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
sellerSchema.index({ userId: 1 }, { unique: true });
sellerSchema.index({ employeeCode: 1 }, { unique: true, sparse: true });
sellerSchema.index({ partnerId: 1, isActive: 1 });
sellerSchema.index({ isActive: 1, totalSales: -1 });
sellerSchema.index({ role: 1, isActive: 1 });
sellerSchema.index({ 'commissionHistory.period': 1, 'commissionHistory.paid': 1 });

/* =========================================================
 *  Virtuals
 * ========================================================= */
sellerSchema.virtual('hasCommissionCapability').get(function () {
  return this.role === 'employee';
});

sellerSchema.virtual('commissionUsage').get(function () {
  if (!this.hasCommissionCapability) return 0;
  if (this.totalSales === 0) return 0;
  return Number(((this.totalCommission / this.totalSales) * 100).toFixed(2));
});

/* =========================================================
 *  pre('save'):
 *   - forzar comisiones a cero si role === 'partner'
 *   - validar coherencia de tiers
 * ========================================================= */
sellerSchema.pre('save', function (next) {
  // 1. Partner: anular configuración de comisiones
  if (this.role === 'partner') {
    this.commissionType = 'percentage';
    this.commissionRate = 0;
    this.fixedCommissionAmount = 0;
    this.commissionTiers = [];
    this.pendingCommission = 0;
    this.monthlyCommission = 0;
  }

  // 2. Coherencia de tiers
  if (this.commissionType === 'tiered' && this.commissionTiers.length > 0) {
    const sorted = [...this.commissionTiers].sort(
      (a, b) => a.minAmount - b.minAmount
    );
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      if (t.maxAmount !== null && t.maxAmount <= t.minAmount) {
        return next(
          new AppError(
            `Tramo de comisión inválido: maxAmount (${t.maxAmount}) debe ser mayor que minAmount (${t.minAmount})`,
            400
          )
        );
      }
      if (i > 0) {
        const prev = sorted[i - 1];
        if (prev.maxAmount === null) {
          return next(
            new AppError(
              'No puede haber tramos después de un tramo sin tope (maxAmount=null)',
              400
            )
          );
        }
        if (prev.maxAmount > t.minAmount) {
          return next(
            new AppError(
              `Tramos superpuestos: ${prev.minAmount}-${prev.maxAmount} vs ${t.minAmount}-${t.maxAmount}`,
              400
            )
          );
        }
      }
    }
    this.commissionTiers = sorted;
  }

  next();
});

/* =========================================================
 *  Métodos
 * ========================================================= */

/**
 * ¿Este vendedor genera comisiones?
 * Fuente única de verdad: solo employees.
 */
sellerSchema.methods.hasCommission = function () {
  return this.role === 'employee';
};

/**
 * Calcula la comisión para un monto de venta según la configuración.
 * Devuelve { amount, rate } donde rate es el % efectivo (0 si no aplica).
 * NO persiste — solo cálculo.
 */
sellerSchema.methods.calculateCommissionForAmount = function (saleAmount) {
  if (!this.hasCommission()) return { amount: 0, rate: 0 };

  const amt = Number(saleAmount);
  if (!Number.isFinite(amt) || amt <= 0) return { amount: 0, rate: 0 };

  switch (this.commissionType) {
    case 'percentage': {
      const commission = (amt * this.commissionRate) / 100;
      return { amount: Number(commission.toFixed(2)), rate: this.commissionRate };
    }
    case 'fixed': {
      const commission = this.fixedCommissionAmount;
      return {
        amount: Number(commission.toFixed(2)),
        rate: Number(((commission / amt) * 100).toFixed(2)),
      };
    }
    case 'tiered': {
      const tier = this.commissionTiers.find(
        (t) =>
          amt >= t.minAmount && (t.maxAmount === null || amt <= t.maxAmount)
      );
      if (!tier) return { amount: 0, rate: 0 };
      const commission = (amt * tier.rate) / 100;
      return { amount: Number(commission.toFixed(2)), rate: tier.rate };
    }
    default:
      return { amount: 0, rate: 0 };
  }
};

/**
 * Registra una venta al vendedor.
 * - Siempre actualiza métricas (salesCount, totalSales, monthlySales)
 * - Solo genera comisión si hasCommission()
 */
sellerSchema.methods.recordSale = function (saleData) {
  const amt = Number(saleData.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError('El monto de la venta debe ser positivo', 400);
  }
  if (!saleData.saleId) {
    throw new AppError('Se requiere el ID de la venta', 400);
  }

  this.salesCount += 1;
  this.totalSales += amt;
  this.monthlySales += amt;
  this.lastSaleDate = new Date();

  if (this.hasCommission()) {
    const { amount: commission, rate } = this.calculateCommissionForAmount(amt);
    if (commission > 0) {
      const period = formatPeriod(new Date());
      this.totalCommission += commission;
      this.pendingCommission += commission;
      this.monthlyCommission += commission;
      this.commissionHistory.push({
        saleId: saleData.saleId,
        saleDate: new Date(),
        saleAmount: amt,
        rate,
        amount: commission,
        period,
        paid: false,
      });
    }
  }

  return this;
};

/**
 * Registra el pago de comisiones pendientes.
 * Marca como pagadas las entradas no pagadas que correspondan al período
 * indicado (o todas si no se pasa `period`).
 * Solo aplica a employees (un partner no debería tener pendientes).
 */
sellerSchema.methods.recordCommissionPayment = function (
  amount,
  options = {}
) {
  if (!this.hasCommission()) {
    throw new AppError(
      'Los partners no reciben comisiones, no se puede registrar un pago de comisión',
      400
    );
  }

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError('El monto del pago debe ser positivo', 400);
  }
  if (amt > this.pendingCommission) {
    throw new AppError(
      `El monto (${amt}) supera la comisión pendiente (${this.pendingCommission})`,
      400
    );
  }

  const { period, paymentMethod, paymentReference } = options;

  // Seleccionar entradas a pagar (FIFO por fecha)
  const candidates = this.commissionHistory
    .filter((e) => !e.paid && (!period || e.period === period))
    .sort((a, b) => new Date(a.saleDate) - new Date(b.saleDate));

  let remaining = amt;
  const now = new Date();
  for (const entry of candidates) {
    if (remaining <= 0) break;
    if (entry.amount <= remaining) {
      entry.paid = true;
      entry.paidAt = now;
      entry.paymentMethod = paymentMethod || null;
      entry.paymentReference = paymentReference || null;
      remaining = Number((remaining - entry.amount).toFixed(2));
    }
  }

  if (remaining > 0.01) {
    throw new AppError(
      'No hay suficientes entradas de comisión pendientes para cubrir el monto indicado',
      400
    );
  }

  this.paidCommission += amt;
  this.pendingCommission = Number((this.pendingCommission - amt).toFixed(2));
  this.lastCommissionPaymentDate = now;

  return this;
};

/**
 * Devuelve las entradas de comisión pendientes (no pagadas).
 */
sellerSchema.methods.getPendingCommissions = function (period = null) {
  return this.commissionHistory.filter(
    (e) => !e.paid && (!period || e.period === period)
  );
};

/**
 * Reinicia las métricas mensuales (sales del mes, comisión del mes).
 * NO toca totalSales / totalCommission / history.
 */
sellerSchema.methods.resetMonthlyMetrics = function () {
  this.monthlySales = 0;
  this.monthlyCommission = 0;
  this.monthlyResetAt = new Date();
  return this;
};

/* =========================================================
 *  Statics
 * ========================================================= */

/** Búsqueda por userId. Devuelve Query (chainable). */
sellerSchema.statics.findByUserId = function (userId) {
  return this.findOne({ userId, isActive: true });
};

/**
 * Top vendedores por monto total vendido.
 */
sellerSchema.statics.getTopSellers = function (limit = 5, options = {}) {
  const filter = { isActive: true };
  if (options.partnerId) filter.partnerId = options.partnerId;
  if (options.role) filter.role = options.role;

  return this.find(filter)
    .sort({ totalSales: -1, salesCount: -1 })
    .limit(Math.min(Number(limit) || 5, 50))
    .lean({ virtuals: true });
};

/**
 * Calcula las comisiones agregadas de un período (YYYY-MM) para
 * todos los vendedores activos que sean employees.
 */
sellerSchema.statics.calculateCommissionsForPeriod = async function (period) {
  return this.aggregate([
    { $match: { isActive: true, role: 'employee' } },
    { $unwind: '$commissionHistory' },
    { $match: { 'commissionHistory.period': period } },
    {
      $group: {
        _id: '$_id',
        sellerName: { $first: '$displayName' },
        partnerId: { $first: '$partnerId' },
        totalSales: { $sum: '$commissionHistory.saleAmount' },
        totalCommission: { $sum: '$commissionHistory.amount' },
        paidCommission: {
          $sum: {
            $cond: ['$commissionHistory.paid', '$commissionHistory.amount', 0],
          },
        },
        pendingCommission: {
          $sum: {
            $cond: [
              { $eq: ['$commissionHistory.paid', false] },
              '$commissionHistory.amount',
              0,
            ],
          },
        },
        entriesCount: { $sum: 1 },
      },
    },
    { $sort: { totalCommission: -1 } },
  ]);
};

/* =========================================================
 *  Helper: formato período "YYYY-MM"
 * ========================================================= */
function formatPeriod(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

module.exports = mongoose.model('Seller', sellerSchema);
module.exports.COMMISSION_TYPES = COMMISSION_TYPES;
module.exports.SELLER_ROLES = SELLER_ROLES;
module.exports.formatPeriod = formatPeriod;