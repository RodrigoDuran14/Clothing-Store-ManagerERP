const Voucher = require('../models/Voucher');
const AppError = require('../utils/AppError');

/* =========================================================
 *  Emisión
 * ========================================================= */

/**
 * Emite un voucher nuevo.
 * @param {Object} data - { type, originalAmount, ... }
 * @returns {Voucher}
 */
const issueVoucher = async (data) => {
  const {
    type,
    origin = 'manual',
    originalAmount,
    currency = 'ARS',
    minimumPurchase = 0,
    applicableCategories = [],
    applicableProducts = [],
    applicableChannels = [],
    isStackable = false,
    maxUses = 1,
    expiresAt = null,
    clientId = null,
    issuedTo = null,
    returnId = null,
    issuedSaleId = null,
    notes = null,
    createdBy,
    code = null,
  } = data;

  if (!createdBy) throw new AppError('Se requiere el usuario que emite el voucher', 400);

  const amount = Number(originalAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('El monto del voucher debe ser positivo', 400);
  }

  const voucher = new Voucher({
    code: code ? String(code).toUpperCase() : undefined,
    type,
    origin,
    originalAmount: amount,
    remainingAmount: amount,
    currency,
    minimumPurchase: Number(minimumPurchase) || 0,
    applicableCategories,
    applicableProducts,
    applicableChannels,
    isStackable,
    maxUses: Number(maxUses) || 1,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    clientId,
    issuedTo,
    returnId,
    issuedSaleId,
    notes,
    createdBy,
  });

  return voucher.save();
};

/**
 * Emite un lote de vouchers (típico de promociones).
 * Si viene `code` + `count > 1`, se genera `code-1`, `code-2`, etc.
 * Si no, se autogeneran códigos individuales.
 */
const issueBulkVouchers = async (template, count, createdBy) => {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 500) {
    throw new AppError('count debe ser un entero entre 1 y 500', 400);
  }

  const vouchers = [];
  for (let i = 0; i < n; i++) {
    const code = template.code
      ? `${template.code}-${String(i + 1).padStart(3, '0')}`
      : null;

    const v = await issueVoucher({ ...template, code, createdBy });
    vouchers.push(v);
  }
  return vouchers;
};

/* =========================================================
 *  Consulta
 * ========================================================= */

/**
 * Busca un voucher por código. Lanza 404 si no existe.
 */
const findByCode = async (code) => {
  const normalized = String(code).toUpperCase().trim();
  const voucher = await Voucher.findOne({ code: normalized });
  if (!voucher) throw new AppError(`Voucher no encontrado: ${normalized}`, 404);
  return voucher;
};

/* =========================================================
 *  Validación (para usar en una venta)
 * ========================================================= */

/**
 * Valida un código de voucher contra un contexto de venta.
 * Read-only. Devuelve info con `ok` y `reason`.
 */
const validateForSale = async (code, saleContext) => {
  let voucher;
  try {
    voucher = await findByCode(code);
  } catch (err) {
    return { ok: false, reason: 'not-found', code };
  }

  const check = voucher.canBeUsedOn(saleContext);
  return {
    ...check,
    code: voucher.code,
    voucherId: voucher._id,
    type: voucher.type,
    remainingAmount: voucher.remainingAmount,
    isStackable: voucher.isStackable,
    expiresAt: voucher.expiresAt,
    clientId: voucher.clientId,
  };
};

/**
 * Valida un array de vouchers y calcula cuánto se puede aplicar en total.
 * Aplica la regla de `isStackable`: si alguno no es stackable y hay más de uno, error.
 *
 * @param {string[]} codes - Códigos a validar
 * @param {Object} saleContext - { total, channel, clientId, productIds, categoryIds }
 * @returns {Object} { valid, vouchers, totalAvailable, issues }
 */
const validateMultipleForSale = async (codes, saleContext) => {
  const vouchers = [];
  const issues = [];

  for (const code of codes) {
    const result = await validateForSale(code, saleContext);
    if (!result.ok) {
      issues.push(result);
    } else {
      vouchers.push(result);
    }
  }

  // Regla de stacking: si hay más de uno, todos deben ser stackable
  if (vouchers.length > 1) {
    const nonStackable = vouchers.filter((v) => !v.isStackable);
    if (nonStackable.length > 0) {
      return {
        valid: false,
        vouchers: [],
        totalAvailable: 0,
        issues: [
          {
            ok: false,
            reason: 'not-stackable',
            codes: nonStackable.map((v) => v.code),
            message: 'Uno o más vouchers no se pueden combinar con otros',
          },
        ],
      };
    }
  }

  const totalAvailable = vouchers.reduce((s, v) => s + v.remainingAmount, 0);

  return {
    valid: issues.length === 0,
    vouchers,
    totalAvailable,
    issues,
  };
};

/**
 * Distribuye el monto a aplicar entre los vouchers disponibles.
 * Retorna [{ voucherId, code, amount }].
 */
const distributeAmount = (vouchers, totalToApply) => {
  let remaining = Number(totalToApply);
  const result = [];

  for (const v of vouchers) {
    if (remaining <= 0) break;
    const amount = Number(Math.min(v.remainingAmount, remaining).toFixed(2));
    if (amount > 0) {
      result.push({
        voucherId: v.voucherId,
        code: v.code,
        amount,
      });
      remaining = Number((remaining - amount).toFixed(2));
    }
  }
  return result;
};

/* =========================================================
 *  Redención
 * ========================================================= */

/**
 * Redime un voucher sobre una venta.
 * Usa actualización atómica para evitar dobles usos concurrentes.
 */
const redeemVoucher = async (code, saleId, amount, userId) => {
  const normalized = String(code).toUpperCase().trim();
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError('El monto a redimir debe ser positivo', 400);
  }

  // Check + increment atómico
  const voucher = await Voucher.findOneAndUpdate(
    {
      code: normalized,
      status: 'active',
      isActive: true,
      remainingAmount: { $gte: amt },
    },
    { $inc: { remainingAmount: -amt, usageCount: 1 } },
    { new: true }
  );

  if (!voucher) {
    throw new AppError(
      `Voucher ${normalized} no disponible para redención (ya usado, expirado o saldo insuficiente)`,
      400
    );
  }

  // Redondear por seguridad (el $inc puede dejar residuo de coma flotante)
  voucher.remainingAmount = Number(voucher.remainingAmount.toFixed(2));

  voucher.redemptions.push({
    saleId,
    amount: amt,
    redeemedBy: userId,
    redeemedAt: new Date(),
  });

  if (voucher.remainingAmount === 0 || voucher.usageCount >= voucher.maxUses) {
    voucher.status = 'redeemed';
  }

  await voucher.save();
  return voucher;
};

/**
 * Devuelve el monto usado de un voucher (para rollback de ventas).
 * Incrementa `remainingAmount` y decrementa `usageCount`.
 */
const refundVoucherUse = async (voucherId, saleId, amount, userId) => {
  const voucher = await Voucher.findById(voucherId);
  if (!voucher) return null;

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;

  // Remover la redención
  const idx = voucher.redemptions.findIndex(
    (r) => r.saleId.toString() === saleId.toString() && r.amount === amt
  );
  if (idx >= 0) voucher.redemptions.splice(idx, 1);

  voucher.remainingAmount = Number((voucher.remainingAmount + amt).toFixed(2));
  voucher.usageCount = Math.max(0, voucher.usageCount - 1);

  // Volver a activo si estaba redimido
  if (voucher.status === 'redeemed' && voucher.remainingAmount > 0) {
    voucher.status = 'active';
  }

  await voucher.save();
  return voucher;
};

/* =========================================================
 *  Vencimiento (job)
 * ========================================================= */
const expireVouchers = async () => {
  const now = new Date();
  const result = await Voucher.updateMany(
    {
      status: 'active',
      isActive: true,
      expiresAt: { $ne: null, $lte: now },
    },
    { $set: { status: 'expired', isActive: false } }
  );
  return { expiredCount: result.modifiedCount, at: now };
};

/* =========================================================
 *  Reportes
 * ========================================================= */
const getVoucherSummary = async (options = {}) => {
  const match = {};
  if (options.type) match.type = options.type;
  if (options.status) match.status = options.status;
  if (options.from || options.to) {
    match.createdAt = {};
    if (options.from) match.createdAt.$gte = new Date(options.from);
    if (options.to) match.createdAt.$lte = new Date(options.to);
  }

  const [byType, byStatus, totals] = await Promise.all([
    Voucher.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          originalAmount: { $sum: '$originalAmount' },
          remainingAmount: { $sum: '$remainingAmount' },
          redeemedAmount: {
            $sum: { $subtract: ['$originalAmount', '$remainingAmount'] },
          },
        },
      },
    ]),
    Voucher.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Voucher.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalCount: { $sum: 1 },
          totalIssued: { $sum: '$originalAmount' },
          totalOutstanding: {
            $sum: {
              $cond: [{ $eq: ['$status', 'active'] }, '$remainingAmount', 0],
            },
          },
          totalRedeemed: {
            $sum: { $subtract: ['$originalAmount', '$remainingAmount'] },
          },
        },
      },
    ]),
  ]);

  return {
    byType: byType.reduce((acc, r) => {
      acc[r._id] = {
        count: r.count,
        issued: r.originalAmount,
        outstanding: r.remainingAmount,
        redeemed: r.redeemedAmount,
      };
      return acc;
    }, {}),
    byStatus: byStatus.reduce((acc, r) => {
      acc[r._id] = r.count;
      return acc;
    }, {}),
    totals: totals[0] || {
      totalCount: 0,
      totalIssued: 0,
      totalOutstanding: 0,
      totalRedeemed: 0,
    },
  };
};

module.exports = {
  issueVoucher,
  issueBulkVouchers,
  findByCode,
  validateForSale,
  validateMultipleForSale,
  distributeAmount,
  redeemVoucher,
  refundVoucherUse,
  expireVouchers,
  getVoucherSummary,
};