const Seller = require('../models/Seller');
const AppError = require('../utils/AppError');
const { formatPeriod } = require('../models/Seller');

/* =========================================================
 *  Cálculo de comisión
 * ========================================================= */

/**
 * Calcula la comisión para una venta concreta.
 * Retorna { amount: 0, rate: 0 } si el vendedor es partner.
 */
const calculateSaleCommission = (seller, saleAmount) => {
  if (!seller || typeof seller.calculateCommissionForAmount !== 'function') {
    throw new AppError('Seller inválido para calcular comisión', 400);
  }
  return seller.calculateCommissionForAmount(saleAmount);
};

/**
 * Agrega comisiones de un período para todos los sellers employees.
 * @param {string} period - "YYYY-MM"
 */
const calculatePeriodCommissions = async (period) => {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new AppError('Período inválido. Use formato YYYY-MM', 400);
  }
  const rows = await Seller.calculateCommissionsForPeriod(period);
  const totals = rows.reduce(
    (acc, r) => {
      acc.totalSales += r.totalSales;
      acc.totalCommission += r.totalCommission;
      acc.paidCommission += r.paidCommission;
      acc.pendingCommission += r.pendingCommission;
      return acc;
    },
    {
      totalSales: 0,
      totalCommission: 0,
      paidCommission: 0,
      pendingCommission: 0,
    }
  );
  return { period, sellers: rows, totals, sellersCount: rows.length };
};

/* =========================================================
 *  Pagos
 * ========================================================= */

/**
 * Procesa el pago de comisiones de un vendedor.
 * Solo aplica a employees (el modelo lo valida también).
 */
const processCommissionPayment = async (sellerId, amount, options = {}) => {
  const seller = await Seller.findById(sellerId);
  if (!seller) throw new AppError('Vendedor no encontrado', 404);

  if (seller.role === 'partner') {
    throw new AppError(
      'Los partners no reciben comisiones. Use el módulo de utilidades.',
      400
    );
  }
  if (!seller.isActive) {
    throw new AppError(
      'No se puede pagar comisión a un vendedor inactivo',
      400
    );
  }

  seller.recordCommissionPayment(amount, {
    period: options.period || null,
    paymentMethod: options.paymentMethod || null,
    paymentReference: options.paymentReference || null,
  });

  await seller.save();
  return seller;
};

/* =========================================================
 *  Resumen y reportes
 * ========================================================= */

/**
 * Resumen de comisiones de un vendedor.
 * Para un partner, devuelve estructura con ceros y flag `hasCommission: false`.
 */
const getSellerCommissionSummary = async (sellerId, options = {}) => {
  const seller = await Seller.findById(sellerId).select(
    'displayName role commissionType commissionRate fixedCommissionAmount ' +
      'commissionTiers salesCount totalSales totalCommission paidCommission ' +
      'pendingCommission monthlySales monthlyCommission lastSaleDate ' +
      'lastCommissionPaymentDate commissionHistory'
  );
  if (!seller) throw new AppError('Vendedor no encontrado', 404);

  const hasCommission = seller.hasCommission();
  const period = options.period || formatPeriod(new Date());

  const pendingEntries = hasCommission
    ? seller.commissionHistory.filter((e) => !e.paid)
    : [];
  const pendingByPeriod = pendingEntries.reduce((acc, e) => {
    acc[e.period] = (acc[e.period] || 0) + e.amount;
    return acc;
  }, {});

  const recentEntries = hasCommission
    ? [...seller.commissionHistory]
        .sort((a, b) => new Date(b.saleDate) - new Date(a.saleDate))
        .slice(0, 20)
    : [];

  return {
    sellerId: seller._id,
    sellerName: seller.displayName,
    role: seller.role,
    hasCommission,

    // Config actual
    commissionConfig: hasCommission
      ? {
          type: seller.commissionType,
          rate: seller.commissionRate,
          fixedAmount: seller.fixedCommissionAmount,
          tiers: seller.commissionTiers,
        }
      : null,

    // Métricas
    salesCount: seller.salesCount,
    totalSales: seller.totalSales,
    monthlySales: seller.monthlySales,
    lastSaleDate: seller.lastSaleDate,

    // Comisiones (ceros si partner)
    totalCommission: hasCommission ? seller.totalCommission : 0,
    paidCommission: hasCommission ? seller.paidCommission : 0,
    pendingCommission: hasCommission ? seller.pendingCommission : 0,
    monthlyCommission: hasCommission ? seller.monthlyCommission : 0,
    lastCommissionPaymentDate: hasCommission
      ? seller.lastCommissionPaymentDate
      : null,
    pendingByPeriod,
    recentEntries,
    requestedPeriod: period,
  };
};

/**
 * Reporte completo de comisiones para un período (o rango).
 * Incluye totales y desglose por vendedor.
 */
const generateCommissionReport = async (options = {}) => {
  const { period, from, to } = options;

  if (!period && (!from || !to)) {
    throw new AppError(
      'Debe especificar un período (YYYY-MM) o un rango (from, to)',
      400
    );
  }

  const match = { isActive: true, role: 'employee' };
  const historyMatch = {};

  if (period) historyMatch['commissionHistory.period'] = period;
  if (from && to) {
    historyMatch['commissionHistory.saleDate'] = {
      $gte: new Date(from),
      $lte: new Date(to),
    };
  }

  const pipeline = [
    { $match: match },
    { $unwind: '$commissionHistory' },
    { $match: historyMatch },
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
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: '_sellerDoc',
        pipeline: [{ $project: { userId: 1 } }],
      },
    },
    { $sort: { totalCommission: -1 } },
  ];

  const sellers = await Seller.aggregate(pipeline);
  const totals = sellers.reduce(
    (acc, s) => {
      acc.totalSales += s.totalSales;
      acc.totalCommission += s.totalCommission;
      acc.paidCommission += s.paidCommission;
      acc.pendingCommission += s.pendingCommission;
      acc.entriesCount += s.entriesCount;
      return acc;
    },
    {
      totalSales: 0,
      totalCommission: 0,
      paidCommission: 0,
      pendingCommission: 0,
      entriesCount: 0,
    }
  );

  return {
    period: period || null,
    range: from && to ? { from, to } : null,
    sellersCount: sellers.length,
    totals,
    sellers,
    generatedAt: new Date(),
  };
};

/* =========================================================
 *  Mantenimiento
 * ========================================================= */

/**
   * Reinicia métricas mensuales de TODOS los vendedores activos.
 * Pensado para cron a principio de cada mes.
 */
const resetMonthlyMetrics = async () => {
  const sellers = await Seller.find({ isActive: true });
  let count = 0;
  for (const seller of sellers) {
    seller.resetMonthlyMetrics();
    await seller.save();
    count += 1;
  }
  return { resetCount: count, resetAt: new Date() };
};

module.exports = {
  calculateSaleCommission,
  calculatePeriodCommissions,
  processCommissionPayment,
  getSellerCommissionSummary,
  generateCommissionReport,
  resetMonthlyMetrics,
};