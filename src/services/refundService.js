const Sale = require('../models/Sale');
const Client = require('../models/Client');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const PartnerSplit = require('../models/PartnerSplit');
const Return = require('../models/Return');
const AppError = require('../utils/AppError');
const stockService = require('./stockService');
const partnerSplitService = require('./partnerSplitService');
const voucherService = require('./voucherService'); 

/* =========================================================
 *  Constantes
 * ========================================================= */
const DEFAULT_RETURN_PERIOD_DAYS = 30;
const VOUCHER_VALIDITY_DAYS = Number(process.env.VOUCHER_VALIDITY_DAYS) || 90;

/* =========================================================
 *  Utilidades
 * ========================================================= */

/**
 * Valida que la venta esté dentro del período permitido para devolución.
 * Configurable por env RETURN_PERIOD_DAYS (default 30).
 */
const validateReturnPeriod = (saleDate, maxDays = DEFAULT_RETURN_PERIOD_DAYS) => {
  const fromEnv = Number(process.env.RETURN_PERIOD_DAYS);
  const days = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : maxDays;
  const diff = Date.now() - new Date(saleDate).getTime();
  const daysDiff = Math.floor(diff / (24 * 60 * 60 * 1000));
  return {
    valid: daysDiff <= days,
    daysSinceSale: daysDiff,
    maxDays: days,
    expiresAt: new Date(new Date(saleDate).getTime() + days * 24 * 60 * 60 * 1000),
  };
};

/**
 * ¿Se puede devolver este item?
 * Delega en Sale.getRemainingReturnable (Módulo 7).
 */
const canReturnProduct = (sale, productId, size, color, quantity) => {
  const remaining = sale.getRemainingReturnable(productId, size, color);
  return {
    canReturn: remaining.available >= Number(quantity),
    ...remaining,
    requested: Number(quantity),
  };
};

/**
 * Calcula el monto del refund a partir de los items devueltos.
 * Aplica el taxRate de la venta original.
 */
const calculateRefundAmount = (items, sale) => {
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const taxRate = sale.taxRate || 0;
  const tax = Number(((subtotal * taxRate) / 100).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));
  return { subtotal, tax, total, taxRate };
};

/* =========================================================
 *  Reversión de comisión
 * ========================================================= */

/**
 * Revierte la comisión del vendedor original, proporcional a lo devuelto.
 * No persiste — el caller hace `seller.save()`.
 */
const revertCommission = (seller, originalSale, refundSubtotal) => {
  if (!seller || !seller.hasCommission || !seller.hasCommission()) {
    return { sellerId: null, reversedAmount: 0 };
  }
  const entry = seller.commissionHistory.find(
    (e) => e.saleId && e.saleId.equals(originalSale._id) && !e.paid
  );
  if (!entry) return { sellerId: seller._id, reversedAmount: 0 };

  const ratio = refundSubtotal / (originalSale.subtotal || 1);
  let reversedAmount = Number((entry.amount * ratio).toFixed(2));
  reversedAmount = Math.min(reversedAmount, entry.amount);

  seller.pendingCommission = Math.max(
    0,
    Number((seller.pendingCommission - reversedAmount).toFixed(2))
  );
  seller.totalCommission = Math.max(
    0,
    Number((seller.totalCommission - reversedAmount).toFixed(2))
  );
  seller.monthlyCommission = Math.max(
    0,
    Number((seller.monthlyCommission - reversedAmount).toFixed(2))
  );

  if (ratio >= 0.999) {
    seller.commissionHistory.pull(entry._id);
  } else {
    entry.amount = Number((entry.amount - reversedAmount).toFixed(2));
    entry.saleAmount = Number((entry.saleAmount - refundSubtotal).toFixed(2));
  }

  return { sellerId: seller._id, reversedAmount };
};

/* =========================================================
 *  Ajustes de PartnerSplit
 * ========================================================= */

/**
 * Ajusta los splits de la venta original para reflejar los items devueltos.
 * - Si el split queda en 0 → `cancelled`
 * - Si queda parcial → `adjusted` + adjustment[] entry
 */
const adjustPartnerSplits = async (originalSale, returnDoc) => {
  const adjustments = [];

  // Agrupar items devueltos por partner
  const byPartner = {};
  for (const item of returnDoc.items) {
    if (!item.partnerId) continue;
    const key = item.partnerId.toString();
    byPartner[key] = (byPartner[key] || 0) + item.subtotal;
  }

  for (const [partnerId, returnedSubtotal] of Object.entries(byPartner)) {
    const split = await PartnerSplit.findOne({
      saleId: originalSale._id,
      partnerId,
      status: { $in: ['pending', 'adjusted'] },
    });
    if (!split) {
      // Split ya cancelado o settled — no se ajusta (requiere revisión manual)
      adjustments.push({
        partnerId,
        splitId: null,
        reversedAmount: returnedSubtotal,
        newSplitId: null,
      });
      continue;
    }

    const reversedAmount = Math.min(returnedSubtotal, split.partnerAmount);
    const newPartnerAmount = Number((split.partnerAmount - reversedAmount).toFixed(2));

    split.partnerAmount = newPartnerAmount;
    split.grossAmount = Math.max(0, Number((split.grossAmount - reversedAmount).toFixed(2)));
    split.adjustments = split.adjustments || [];
    split.adjustments.push({
      returnId: returnDoc._id,
      returnNumber: returnDoc.returnNumber,
      amount: -reversedAmount,
      reason: `Devolución ${returnDoc.returnNumber}`,
    });

    if (newPartnerAmount === 0) {
      split.status = 'cancelled';
    } else {
      split.status = 'adjusted';
    }
    await split.save();

    adjustments.push({
      partnerId,
      splitId: split._id,
      reversedAmount,
      newSplitId: null,
    });
  }

  return adjustments;
};

/**
 * Crea los splits nuevos para la venta de exchange.
 * Reutiliza el servicio existente.
 */
const createSplitsForExchange = async (exchangeSale) => {
  return partnerSplitService.assignItemsToPartners(exchangeSale);
};

/* =========================================================
 *  Actualización de la venta original
 * ========================================================= */

/**
 * Actualiza la venta original:
 * - Acumula `returnedItems`, `returnedTotal`, `returnsCount`
 * - Transiciona `status` a `partially_refunded` o `refunded`
 * No persiste — el caller hace `sale.save()`.
 */
const updateSaleAfterReturn = (originalSale, returnDoc) => {
  originalSale.hasReturns = true;
  originalSale.returnsCount = (originalSale.returnsCount || 0) + 1;
  originalSale.returnedTotal = Number(
    ((originalSale.returnedTotal || 0) + returnDoc.refundTotal).toFixed(2)
  );

  // Acumular items devueltos
  for (const item of returnDoc.items) {
    const existing = originalSale.returnedItems.find(
      (r) =>
        r.productId.equals(item.productId) &&
        r.size === item.size &&
        r.color === item.color
    );
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      originalSale.returnedItems.push({
        productId: item.productId,
        size: item.size,
        color: item.color,
        quantity: item.quantity,
      });
    }
  }

  // Transición de estado
  const fullyReturned = originalSale.returnedTotal >= originalSale.total - 0.01;
  const newStatus = fullyReturned ? 'refunded' : 'partially_refunded';

  if (originalSale.status !== 'refunded') {
    originalSale.status = newStatus;
    originalSale.cancelledAt = new Date();
  }

  return originalSale;
};

/* =========================================================
 *  Procesamiento principal
 * ========================================================= */

/**
 * Procesa una devolución aprobada.
 * Dispatcher: si es refund puro o exchange.
 */
const processReturn = async (returnDoc, actor) => {
  if (!returnDoc.canProcess()) {
    throw new AppError(
      `No se puede procesar una devolución en estado '${returnDoc.status}'`,
      400
    );
  }

  const originalSale = await Sale.findById(returnDoc.saleId);
  if (!originalSale) {
    throw new AppError('Venta original no encontrada', 404);
  }

  // Re-validar que los items sigan disponibles (por si otra devolución los tomó)
  for (const item of returnDoc.items) {
    const check = canReturnProduct(
      originalSale,
      item.productId,
      item.size,
      item.color,
      item.quantity
    );
    if (!check.canReturn) {
      throw new AppError(
        `El item "${item.productName}" (${item.size}/${item.color}) ya no tiene unidades disponibles para devolver. ` +
          `Disponibles: ${check.available}, solicitadas: ${item.quantity}`,
        400
      );
    }
  }

  // Si es exchange, verificar stock de los nuevos ANTES de tocar nada
  if (returnDoc.type === 'exchange' && returnDoc.exchangeItems.length > 0) {
    const stockCheck = await stockService.checkStockForSale(returnDoc.exchangeItems);
    if (!stockCheck.ok) {
      throw new AppError(
        `No hay stock para el cambio: ${stockCheck.issues.map((i) => i.message).join('. ')}`,
        400
      );
    }
  }

  // Ejecutar
  let exchangeSale = null;
  let commissionReversal = {
    sellerId: originalSale.sellerId || null,
    reversedAmount: 0,
    newCommission: 0,
    netAmount: 0,
  };
  let partnerAdjustments = [];

  try {
    /* ---------- 1. Restaurar stock de items devueltos ---------- */
    await stockService.restoreStock(returnDoc.items);

    /* ---------- 2. Ajustar splits de partners (reversión) ---------- */
    partnerAdjustments = await adjustPartnerSplits(originalSale, returnDoc);

    /* ---------- 3. Revertir comisión del vendedor original ---------- */
    if (originalSale.sellerId) {
      const seller = await Seller.findById(originalSale.sellerId);
      if (seller) {
        const result = revertCommission(seller, originalSale, returnDoc.refundSubtotal);
        commissionReversal.reversedAmount = result.reversedAmount;

        // Revertir contadores de ventas del seller original
        // (proporcional a lo devuelto, para no castigar el total de ventas)
        const ratio = returnDoc.refundSubtotal / (originalSale.subtotal || 1);
        seller.totalSales = Math.max(
          0,
          Number((seller.totalSales - originalSale.subtotal * ratio).toFixed(2))
        );
        seller.monthlySales = Math.max(
          0,
          Number((seller.monthlySales - originalSale.subtotal * ratio).toFixed(2))
        );

        await seller.save();
      }
    }

    /* ---------- 4. Si es exchange: crear venta nueva ---------- */
    if (returnDoc.type === 'exchange' && returnDoc.exchangeItems.length > 0) {
      // 4a. Deducción de stock (atómica con rollback)
      await stockService.deductStockForSale(returnDoc.exchangeItems);

      // 4b. Crear Sale
      const now = new Date();
      const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const count = await Sale.countDocuments({ createdAt: { $gte: monthStart } });
      const exchangeSaleNumber = `S-${yyyymm}-X${String(count + 1).padStart(4, '0')}`;

      // Pagos: si balanceDue > 0, el cliente pagó la diferencia
      const payments = [];
      if (returnDoc.balanceDue > 0 && returnDoc.balancePaymentMethod) {
        payments.push({
          method: returnDoc.balancePaymentMethod === 'voucher' ? 'other' : returnDoc.balancePaymentMethod,
          amount: Number(returnDoc.balanceDue.toFixed(2)),
          date: new Date(),
          reference: returnDoc.balancePaymentReference || null,
          receivedBy: actor._id,
        });
      }

      exchangeSale = await Sale.create({
        saleNumber: exchangeSaleNumber,
        clientId: originalSale.clientId,
        sellerId: originalSale.sellerId,
        createdBy: actor._id,
        items: returnDoc.exchangeItems,
        subtotal: returnDoc.exchangeSubtotal,
        discountType: 'amount',
        discountValue: 0,
        discountAmount: 0,
        taxRate: originalSale.taxRate,
        taxAmount: returnDoc.exchangeTax,
        total: returnDoc.exchangeTotal,
        payments,
        paymentStatus: 'paid',
        status: 'completed',
        completedAt: new Date(),
        channel: originalSale.channel,
        notes: `Exchange de venta ${originalSale.saleNumber}`,
        originalSaleId: originalSale._id,
      });

      // 4c. Nuevos splits
      const newSplits = await createSplitsForExchange(exchangeSale);

      // Vincular splits nuevos con adjustments
      for (const split of newSplits) {
        const existingAdj = partnerAdjustments.find(
          (a) => a.partnerId.toString() === split.partnerId.toString()
        );
        if (existingAdj) {
          existingAdj.newSplitId = split._id;
        } else {
          partnerAdjustments.push({
            partnerId: split.partnerId,
            splitId: null,
            reversedAmount: 0,
            newSplitId: split._id,
          });
        }
      }

      // 4d. Nueva comisión
      if (originalSale.sellerId) {
        const seller = await Seller.findById(originalSale.sellerId);
        if (seller) {
          seller.recordSale({ amount: returnDoc.exchangeTotal, saleId: exchangeSale._id });
          await seller.save();
          const newEntry = seller.commissionHistory.find(
            (e) => e.saleId && e.saleId.equals(exchangeSale._id)
          );
          commissionReversal.newCommission = newEntry ? newEntry.amount : 0;
        }
      }

      // 4e. Historial del cliente
      if (originalSale.clientId) {
        const client = await Client.findById(originalSale.clientId);
        if (client) {
          client.addPurchaseToHistory(
            exchangeSale._id,
            returnDoc.exchangeTotal,
            returnDoc.exchangeItems.map((i) => ({
              productId: i.productId,
              name: i.productName,
              quantity: i.quantity,
              price: i.unitPrice,
              size: i.size,
              color: i.color,
            }))
          );
          await client.save();
        }
      }
    }

    /* ---------- 5. Reembolso al cliente (si balanceDue < 0 o refund puro) ---------- */
    const totalToRefundToClient =
      returnDoc.type === 'refund'
        ? returnDoc.refundTotal
        : Math.max(0, -returnDoc.balanceDue);

    let refundDetails = { method: returnDoc.refundMethod, amount: 0 };

    if (totalToRefundToClient > 0 && returnDoc.refundMethod) {
      refundDetails.amount = totalToRefundToClient;

      // 5a. Reembolso a cuenta corriente
      if (returnDoc.refundMethod === 'credit_account' && originalSale.clientId) {
        const client = await Client.findById(originalSale.clientId);
        if (client) {
          try {
            client.addCreditMovement(
              'return',
              totalToRefundToClient,
              `Devolución ${returnDoc.returnNumber}`,
              { saleId: originalSale._id, createdBy: actor._id }
            );
            await client.save();
          } catch (err) {
            // Si el cliente no tenía deuda suficiente, se registra la diferencia como saldo a favor manual
            console.warn(
              `⚠️  No se pudo acreditar todo el monto a cuenta corriente: ${err.message}. ` +
                `Registrar saldo a favor manualmente.`
            );
          }
        }
      }

      // 5b. Voucher → emitir voucher real
    if (returnDoc.refundMethod === 'voucher') {
      const voucher = await voucherService.issueVoucher({
        type: 'return_credit',
        origin: 'return',
        originalAmount: totalToRefundToClient,
        clientId: originalSale.clientId || null,
        returnId: returnDoc._id,
        issuedSaleId: originalSale._id,
        expiresAt: new Date(
          Date.now() + VOUCHER_VALIDITY_DAYS * 24 * 60 * 60 * 1000
        ),
        notes: `Devolución ${returnDoc.returnNumber}`,
        createdBy: actor._id,
      });

      refundDetails.voucherCode = voucher.code;
      refundDetails.voucherExpiresAt = voucher.expiresAt;
      refundDetails.method = 'voucher';
      refundDetails.amount = totalToRefundToClient;
      refundDetails.processedAt = new Date();
      refundDetails.processedBy = actor._id;
    }
    }

    /* ---------- 6. Historial del cliente (marcar compra original) ---------- */
    if (originalSale.clientId) {
      const client = await Client.findById(originalSale.clientId);
      if (client) {
        const entry = client.purchaseHistory.find(
          (p) => p.saleId && p.saleId.equals(originalSale._id)
        );
        if (entry) {
          entry.returnedTotal = Number(
            ((entry.returnedTotal || 0) + returnDoc.refundTotal).toFixed(2)
          );
          entry.lastReturnDate = new Date();
          const fullyReturned =
            entry.returnedTotal >= entry.total - 0.01;
          entry.status = fullyReturned ? 'returned' : 'partially_returned';
          await client.save();
        }
      }
    }

    /* ---------- 7. Actualizar venta original ---------- */
    updateSaleAfterReturn(originalSale, returnDoc);
    await originalSale.save();

    /* ---------- 8. Completar Return ---------- */
    commissionReversal.netAmount = Number(
      (commissionReversal.newCommission - commissionReversal.reversedAmount).toFixed(2)
    );

    returnDoc.complete(actor._id, {
      exchangeSaleId: exchangeSale?._id || null,
      exchangeSaleNumber: exchangeSale?.saleNumber || null,
      refundDetails,
      commissionReversal,
      partnerAdjustments,
    });

    // 8a. Si el balance es negativo (tienda devuelve), registrar método
    if (returnDoc.type === 'exchange' && returnDoc.balanceDue < 0) {
      returnDoc.refundDetails.amount = Math.abs(returnDoc.balanceDue);
      returnDoc.refundDetails.processedAt = new Date();
      returnDoc.refundDetails.processedBy = actor._id;
      returnDoc.refundMethod = returnDoc.refundMethod || 'cash';
    }

    await returnDoc.save();

    return { returnDoc, exchangeSale, originalSale };
  } catch (err) {
    // Rollback best-effort del stock ya restaurado
    // (el stock de exchange ya se dedujo con su propio rollback interno)
    console.error(`❌ Error procesando ${returnDoc.returnNumber}:`, err.message);
    throw err;
  }
};

/* =========================================================
 *  Procesamiento auxiliar para refund puro (wrapper)
 * ========================================================= */
const processRefund = async (returnDoc, actor) => {
  if (returnDoc.type !== 'refund') {
    throw new AppError('Esta devolución no es de tipo refund', 400);
  }
  return processReturn(returnDoc, actor);
};

/* =========================================================
 *  Exportaciones
 * ========================================================= */
module.exports = {
  // Utilidades
  validateReturnPeriod,
  canReturnProduct,
  calculateRefundAmount,
  // Internals (exportados para tests)
  revertCommission,
  adjustPartnerSplits,
  updateSaleAfterReturn,
  // Procesamiento
  processRefund,
  processReturn,
};