const PartnerSplit = require('../models/PartnerSplit');

/* =========================================================
 *  Asignación de items a partners (por venta)
 * ========================================================= */
const assignItemsToPartners = async (sale) => {
  const byPartner = {};
  for (const item of sale.items || []) {
    if (!item.partnerId) continue;
    const key = item.partnerId.toString();
    if (!byPartner[key]) byPartner[key] = [];
    byPartner[key].push(item);
  }

  const splits = [];
  for (const [partnerId, items] of Object.entries(byPartner)) {
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0);

    const partnerPercentage = 100;
    const storePercentage = 0;
    const partnerAmount = Number(((subtotal * partnerPercentage) / 100).toFixed(2));
    const storeAmount = Number(((subtotal * storePercentage) / 100).toFixed(2));

    const split = await PartnerSplit.create({
      saleId: sale._id,
      saleNumber: sale.saleNumber,
      partnerId,
      items: items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        subtotal: i.subtotal,
      })),
      itemsSubtotal: subtotal,
      grossAmount: subtotal,
      partnerAmount,
      storeAmount,
      partnerPercentage,
      storePercentage,
      status: 'pending',
    });
    splits.push(split);
  }

  return splits;
};

const registerPartnerIncome = async (sale, splits) => splits;

/* =========================================================
 *  Consultas
 * ========================================================= */
const getPartnerIncomeSummary = async (partnerId, options = {}) => {
  const filter = { partnerId };
  if (options.from && options.to) {
    filter.createdAt = {
      $gte: new Date(options.from),
      $lte: new Date(options.to),
    };
  }
  if (options.status) filter.status = options.status;

  const [agg] = await PartnerSplit.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        totalSplits: { $sum: 1 },
        totalGross: { $sum: '$grossAmount' },
        totalPartnerAmount: { $sum: '$partnerAmount' },
        totalStoreAmount: { $sum: '$storeAmount' },
        pendingSplits: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        settledSplits: { $sum: { $cond: [{ $eq: ['$status', 'settled'] }, 1, 0] } },
        adjustedSplits: { $sum: { $cond: [{ $eq: ['$status', 'adjusted'] }, 1, 0] } },  // 👈 NUEVO
      },
    },
  ]);

  return (
    agg || {
      totalSplits: 0,
      totalGross: 0,
      totalPartnerAmount: 0,
      totalStoreAmount: 0,
      pendingSplits: 0,
      settledSplits: 0,
      adjustedSplits: 0,
    }
  );
};

const calculatePartnerBalances = async () => {
  return PartnerSplit.aggregate([
    { $match: { status: { $in: ['pending', 'adjusted'] } } },   // 👈 incluye adjusted
    {
      $group: {
        _id: '$partnerId',
        totalPendingAmount: { $sum: '$partnerAmount' },
        splitsCount: { $sum: 1 },
      },
    },
    { $sort: { totalPendingAmount: -1 } },
  ]);
};

const cancelSplitsForSale = async (saleId) => {
  return PartnerSplit.updateMany(
    { saleId, status: 'pending' },
    { $set: { status: 'cancelled' } }
  );
};

module.exports = {
  assignItemsToPartners,
  registerPartnerIncome,
  getPartnerIncomeSummary,
  calculatePartnerBalances,
  cancelSplitsForSale,
};