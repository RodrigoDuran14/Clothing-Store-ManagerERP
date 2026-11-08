const Promotion = require('../models/Promotion');
const AppError = require('../utils/AppError');

/* =========================================================
 *  Aplicación de promociones a un carrito
 * ========================================================= */

/**
 * Aplica todas las promociones válidas al carrito.
 * - Automáticas: se obtienen según canal
 * - Cupones: se resuelven desde `couponCodes`
 * - Orden: priority DESC, createdAt ASC (más viejo primero)
 * - Cada descuento se aplica sobre el runningTotal (no sobre subtotal original)
 *
 * @param {Object} saleContext
 *   { items, subtotal, clientId, clientCategory, channel, couponCodes }
 * @returns {Object} { totalDiscount, appliedPromotions, invalidCoupons, finalTotal }
 */
const applyPromotions = async (saleContext) => {
  const {
    items = [],
    subtotal,
    clientId = null,
    clientCategory = null,
    channel = 'pos',
    couponCodes = [],
  } = saleContext;

  const baseTotal = Number(subtotal) || 0;

  /* ---------- 1. Resolver cupones ---------- */
  const invalidCoupons = [];
  const resolvedCoupons = [];

  for (const code of couponCodes) {
    const coupon = await Promotion.getByCode(code);
    if (!coupon) {
      invalidCoupons.push({ code, reason: 'not-found' });
      continue;
    }
    const check = coupon.isValid({
      clientId,
      clientCategory,
      channel,
      currentTotal: baseTotal,
    });
    if (!check.valid) {
      invalidCoupons.push({ code, reason: check.reason, check });
      continue;
    }
    resolvedCoupons.push(coupon);
  }

  // Si hay cupones inválidos, fallar todo (el cliente debe corregir el código)
  if (invalidCoupons.length > 0) {
    return {
      totalDiscount: 0,
      appliedPromotions: [],
      invalidCoupons,
      finalTotal: baseTotal,
      ok: false,
    };
  }

  /* ---------- 2. Combinar automáticas + cupones ---------- */
  const automatic = await Promotion.getActivePromotions({ channel });
  const all = [...automatic, ...resolvedCoupons];

  // Dedupe por _id
  const seen = new Set();
  const unique = all.filter((p) => {
    const id = p._id.toString();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Ordenar: priority DESC, createdAt ASC
  unique.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  /* ---------- 3. Aplicar secuencialmente ---------- */
  let runningTotal = baseTotal;
  const applied = [];

  for (const promo of unique) {
    const check = promo.isValid({
      clientId,
      clientCategory,
      channel,
      currentTotal: runningTotal,
    });
    if (!check.valid) continue;

    // Si no es stackable y ya hay una aplicada, saltarla
    if (!promo.isStackable && applied.length > 0) continue;

    const { amount, freeItems } = promo.calculateDiscount(runningTotal, items);
    if (amount <= 0) continue;

    runningTotal = Number((runningTotal - amount).toFixed(2));
    applied.push({
      promotionId: promo._id,
      name: promo.name,
      code: promo.code,
      type: promo.benefitType,
      amount,
      freeItems: freeItems.length > 0 ? freeItems : undefined,
    });

    // Si esta promoción NO es stackable, cortamos
    if (!promo.isStackable) break;
  }

  return {
    ok: true,
    totalDiscount: Number((baseTotal - runningTotal).toFixed(2)),
    appliedPromotions: applied,
    invalidCoupons: [],
    finalTotal: runningTotal,
  };
};

/* =========================================================
 *  Validación de cupón (preview desde el POS)
 * ========================================================= */

/**
 * Valida un cupón sin aplicarlo. Útil para feedback en vivo al cliente.
 */
const validateCoupon = async (code, saleContext = {}) => {
  const coupon = await Promotion.getByCode(code);
  if (!coupon) {
    return { valid: false, reason: 'not-found', code };
  }

  const check = coupon.isValid({
    clientId: saleContext.clientId,
    clientCategory: saleContext.clientCategory,
    channel: saleContext.channel,
    currentTotal: saleContext.saleTotal,
  });

  return {
    valid: check.valid,
    reason: check.reason || 'ok',
    check,
    coupon: {
      _id: coupon._id,
      code: coupon.code,
      name: coupon.name,
      description: coupon.description,
      benefitType: coupon.benefitType,
      benefitValue: coupon.benefitValue,
      buyXGetY: coupon.buyXGetY,
      maxDiscountAmount: coupon.maxDiscountAmount,
      minPurchaseAmount: coupon.minPurchaseAmount,
      endDate: coupon.endDate,
      remainingUses: coupon.remainingUses,
    },
  };
};

/* =========================================================
 *  Registro de uso (post-creación de venta)
 * ========================================================= */

/**
 * Incrementa contadores de uso de una promoción.
 * Atómico para `usageCount` y `usageByClient.<id>`.
 */
const registerUsage = async (promotionId, clientId = null) => {
  const update = { $inc: { usageCount: 1 } };
  if (clientId) {
    update.$inc[`usageByClient.${clientId.toString()}`] = 1;
  }
  return Promotion.updateOne({ _id: promotionId }, update);
};

/**
 * Registra el uso de múltiples promociones (batch).
 */
const registerMultipleUsages = async (appliedPromotions, clientId = null) => {
  for (const p of appliedPromotions) {
    await registerUsage(p.promotionId, clientId);
  }
};

/* =========================================================
 *  Consultas
 * ========================================================= */

/**
 * Promociones que aplican a un producto concreto (para mostrar en PDP/ecommerce).
 */
const getProductPromotions = async (productId, options = {}) => {
  const now = new Date();
  const filter = {
    isActive: true,
    startDate: { $lte: now },
    $or: [{ endDate: null }, { endDate: { $gte: now } }],
    $and: [
      {
        $or: [
          { applicableProducts: { $size: 0 } },
          { applicableProducts: productId },
        ],
      },
    ],
  };
  if (options.channel) {
    filter.$and.push({
      $or: [
        { applicableChannels: { $size: 0 } },
        { applicableChannels: options.channel },
      ],
    });
  }

  return Promotion.find(filter).sort({ priority: -1, createdAt: 1 });
};

/**
 * Promociones destacadas para mostrar en banners.
 */
const getFeaturedPromotions = async (limit = 5) => {
  return Promotion.getFeatured(limit);
};

/* =========================================================
 *  Exportaciones
 * ========================================================= */
module.exports = {
  applyPromotions,
  validateCoupon,
  registerUsage,
  registerMultipleUsages,
  getProductPromotions,
  getFeaturedPromotions,
};