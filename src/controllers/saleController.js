const Sale = require('../models/Sale');
const Client = require('../models/Client');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const Return = require('../models/Return');
const AppError = require('../utils/AppError');
const stockService = require('../services/stockService');
const partnerSplitService = require('../services/partnerSplitService');
const creditService = require('../services/creditService');
const { paginate, formatPagination } = require('../utils/helpers');
const { ROLES } = require('../config/roles');

/* =========================================================
 *  Helpers
 * ========================================================= */
const buildSaleFilter = (query, user) => {
  const filter = {};

  if (query.status) filter.status = query.status;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.channel) filter.channel = query.channel;
  if (query.clientId) filter.clientId = query.clientId;
  if (query.sellerId) filter.sellerId = query.sellerId;
  if (query.hasReturns !== undefined) {
    filter.hasReturns = query.hasReturns === 'true';
  }

  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }

  if (user && user.role === ROLES.PARTNER && user.partnerId) {
    filter['items.partnerId'] = user.partnerId;
  }

  if (query.search) {
    filter.$or = [
      { saleNumber: { $regex: query.search, $options: 'i' } },
      { 'items.productName': { $regex: query.search, $options: 'i' } },
    ];
  }

  return filter;
};

/* =========================================================
 *  POST /api/sales
 * ========================================================= */
exports.createSale = async (req, res, next) => {
  try {
    const {
      clientId,
      sellerId,
      items: rawItems,
      discountType = 'amount',
      discountValue = 0,
      taxRate = 21,
      payments = [],
      channel = 'pos',
      notes,
    } = req.body;

    /* ---------- 1. Validar cliente ---------- */
    let client = null;
    if (clientId) {
      client = await Client.findById(clientId);
      if (!client) return next(new AppError('Cliente no encontrado', 404));
      if (!client.isActive) {
        return next(new AppError('El cliente está desactivado', 400));
      }
    }

    /* ---------- 2. Validar vendedor ---------- */
    let seller = null;
    if (sellerId) {
      seller = await Seller.findById(sellerId);
      if (!seller) return next(new AppError('Vendedor no encontrado', 404));
      if (!seller.isActive) {
        return next(new AppError('El vendedor está desactivado', 400));
      }
    }

    /* ---------- 3. Construir items con datos del producto ---------- */
    const saleItems = [];
    for (const raw of rawItems) {
      const product = await Product.findById(raw.productId);
      if (!product) {
        return next(new AppError(`Producto no encontrado: ${raw.productId}`, 404));
      }
      if (!product.isActive) {
        return next(new AppError(`Producto inactivo: ${product.name}`, 400));
      }

      const size = String(raw.size).toUpperCase();
      const color = raw.color;
      const variant = product.variants.find(
        (v) => v.size === size && v.color === color
      );
      if (!variant) {
        return next(
          new AppError(
            `Variante no encontrada en "${product.name}" (talle: ${raw.size}, color: ${raw.color})`,
            400
          )
        );
      }

      const quantity = Number(raw.quantity);
      const unitPrice =
        raw.unitPrice !== undefined ? Number(raw.unitPrice) : product.price;
      const discount = Number(raw.discount) || 0;
      const subtotal = Math.max(0, unitPrice * quantity - discount);

      saleItems.push({
        productId: product._id,
        productName: product.name,
        productSku: variant.sku,
        size,
        color,
        quantity,
        unitPrice,
        discount,
        subtotal,
        partnerId: product.partnerId || null,
      });
    }

    /* ---------- 4. Calcular totales ---------- */
    const subtotal = saleItems.reduce((s, i) => s + i.subtotal, 0);

    let discountAmount = 0;
    if (discountType === 'percentage') {
      discountAmount = Number(((subtotal * Number(discountValue)) / 100).toFixed(2));
    } else {
      discountAmount = Number(discountValue) || 0;
    }
    discountAmount = Math.min(discountAmount, subtotal);

    const afterDiscount = subtotal - discountAmount;
    const taxAmount = Number(((afterDiscount * Number(taxRate)) / 100).toFixed(2));
    const total = Number((afterDiscount + taxAmount).toFixed(2));

    /* ---------- 5. Validar pagos ---------- */
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    if (totalPaid > total + 0.01) {
      return next(
        new AppError(
          `El total de pagos ($${totalPaid}) excede el total de la venta ($${total})`,
          400
        )
      );
    }

    /* ---------- 6. Verificar crédito ---------- */
    const creditPayment = payments.find((p) => p.method === 'credit');
    if (creditPayment) {
      if (!client) {
        return next(
          new AppError('Se requiere un cliente registrado para pagos con crédito', 400)
        );
      }
      const check = await creditService.checkCreditBeforeSale(
        client._id,
        Number(creditPayment.amount)
      );
      if (!check.canPurchase) {
        return next(new AppError(check.message, 400));
      }
    }

    /* ---------- 7. Verificar stock ---------- */
    const stockCheck = await stockService.checkStockForSale(saleItems);
    if (!stockCheck.ok) {
      const reasons = stockCheck.issues.map((i) => i.message).join('. ');
      return next(new AppError(`No hay stock suficiente: ${reasons}`, 400));
    }

    /* ---------- 8. Deducción atómica de stock ---------- */
    await stockService.deductStockForSale(saleItems);

    /* ---------- 9. Crear venta ---------- */
    let sale;
    try {
      sale = await Sale.create({
        clientId: client?._id || null,
        sellerId: seller?._id || null,
        createdBy: req.user._id,
        items: saleItems,
        subtotal,
        discountType,
        discountValue,
        discountAmount,
        taxRate,
        taxAmount,
        total,
        payments: payments.map((p) => ({
          method: p.method,
          amount: Number(p.amount),
          date: new Date(),
          bankAccountId: p.bankAccountId || null,
          reference: p.reference || null,
          installments: p.installments || 1,
          receivedBy: req.user._id,
        })),
        paymentStatus:
          totalPaid >= total - 0.01 ? 'paid' : totalPaid > 0 ? 'partial' : 'pending',
        status: totalPaid >= total - 0.01 ? 'completed' : 'pending',
        completedAt: totalPaid >= total - 0.01 ? new Date() : null,
        channel,
        notes: notes || null,
      });
    } catch (err) {
      await stockService.restoreStockForCancellation(saleItems);
      throw err;
    }

    /* ---------- 10. Actualizar cliente ---------- */
    if (client) {
      client.addPurchaseToHistory(
        sale._id,
        total,
        saleItems.map((i) => ({
          productId: i.productId,
          name: i.productName,
          quantity: i.quantity,
          price: i.unitPrice,
          size: i.size,
          color: i.color,
        }))
      );

      if (creditPayment) {
        client.addCreditMovement(
          'purchase',
          Number(creditPayment.amount),
          `Venta ${sale.saleNumber}`,
          { saleId: sale._id, createdBy: req.user._id }
        );
      }

      await client.save();

      Client.updateClientCategory(client._id).catch((e) =>
        console.error('⚠️  updateClientCategory falló:', e.message)
      );
    }

    /* ---------- 11. Actualizar vendedor ---------- */
    if (seller) {
      seller.recordSale({ amount: total, saleId: sale._id });
      await seller.save();
    }

    /* ---------- 12. Splits de partners ---------- */
    let splits = [];
    try {
      splits = await partnerSplitService.assignItemsToPartners(sale);
      await partnerSplitService.registerPartnerIncome(sale, splits);
    } catch (err) {
      console.error('⚠️  PartnerSplit falló (no bloquea la venta):', err.message);
    }

    /* ---------- 13. Respuesta ---------- */
    const populatedSale = await Sale.findById(sale._id)
      .populate('clientId', 'name phone email')
      .populate('sellerId', 'displayName role');

    res.status(201).json({
      success: true,
      data: {
        sale: populatedSale,
        partnerSplits: splits,
        clientUpdated: client
          ? {
              _id: client._id,
              name: client.name,
              creditBalance: client.creditAccount.balance,
              availableCredit: Math.max(
                0,
                client.creditAccount.creditLimit - client.creditAccount.balance
              ),
            }
          : null,
        sellerUpdated: seller
          ? {
              _id: seller._id,
              displayName: seller.displayName,
              role: seller.role,
              totalSales: seller.totalSales,
              pendingCommission: seller.pendingCommission,
              hasCommission: seller.hasCommission(),
            }
          : null,
      },
      message: 'Venta registrada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/sales
 * ========================================================= */
exports.getSales = async (req, res, next) => {
  try {
    const { skip, limit: limitNum, page: pageNum } = paginate(
      req.query.page,
      req.query.limit
    );
    const filter = buildSaleFilter(req.query, req.user);

    const [sales, total] = await Promise.all([
      Sale.find(filter)
        .populate('clientId', 'name phone')
        .populate('sellerId', 'displayName role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Sale.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        sales,
        pagination: formatPagination(total, pageNum, limitNum),
      },
      message: 'Ventas obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/sales/:id[?include=returns]
 *  soporta incluir devoluciones
 * ========================================================= */
exports.getSaleById = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id)
      .populate('clientId', 'name phone email')
      .populate('sellerId', 'displayName role')
      .populate('createdBy', 'name email')
      .populate('originalSaleId', 'saleNumber createdAt');

    if (!sale) return next(new AppError('Venta no encontrada', 404));

    // Partner solo puede ver ventas que incluyan sus productos
    if (
      req.user.role === ROLES.PARTNER &&
      req.user.partnerId &&
      !sale.items.some(
        (i) => i.partnerId && i.partnerId.equals(req.user.partnerId)
      )
    ) {
      return next(new AppError('No tiene permisos para ver esta venta', 403));
    }

    const data = { sale };

    // incluir devoluciones si se pide
    if (req.query.include && req.query.include.includes('returns')) {
      data.returns = await Return.find({ saleId: sale._id })
        .sort({ createdAt: -1 })
        .select(
          'returnNumber type status refundTotal exchangeTotal balanceDue createdAt'
        )
        .lean();
    }

    // incluir venta de origen si es un exchange
    if (req.query.include && req.query.include.includes('exchange')) {
      if (sale.originalSaleId) {
        data.exchangeSale = await Sale.findById(sale.originalSaleId)
          .select('saleNumber total createdAt status')
          .lean();
      }
    }

    res.status(200).json({
      success: true,
      data,
      message: 'Venta obtenida correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/sales/by-number/:saleNumber
 * ========================================================= */
exports.getSaleByNumber = async (req, res, next) => {
  try {
    const sale = await Sale.findOne({ saleNumber: req.params.saleNumber })
      .populate('clientId', 'name phone email')
      .populate('sellerId', 'displayName role');
    if (!sale) return next(new AppError('Venta no encontrada', 404));

    res.status(200).json({
      success: true,
      data: sale,
      message: 'Venta obtenida correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/sales/:id/payments
 * ========================================================= */
exports.addPayment = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) return next(new AppError('Venta no encontrada', 404));

    const { method, amount, reference, installments, bankAccountId } = req.body;

    if (method === 'credit') {
      if (!sale.clientId) {
        return next(
          new AppError('Se requiere un cliente registrado para pagos con crédito', 400)
        );
      }
      const check = await creditService.checkCreditBeforeSale(
        sale.clientId,
        Number(amount)
      );
      if (!check.canPurchase) {
        return next(new AppError(check.message, 400));
      }
    }

    sale.addPayment({
      method,
      amount: Number(amount),
      reference: reference || null,
      installments: installments || 1,
      bankAccountId: bankAccountId || null,
      receivedBy: req.user._id,
    });

    await sale.save();

    if (method === 'credit') {
      const client = await Client.findById(sale.clientId);
      if (client) {
        client.addCreditMovement(
          'purchase',
          Number(amount),
          `Pago venta ${sale.saleNumber}`,
          { saleId: sale._id, createdBy: req.user._id }
        );
        await client.save();
      }
    }

    res.status(200).json({
      success: true,
      data: {
        saleId: sale._id,
        saleNumber: sale.saleNumber,
        total: sale.total,
        paidAmount: sale.paidAmount,
        pendingBalance: sale.pendingBalance,
        paymentStatus: sale.paymentStatus,
        status: sale.status,
      },
      message: 'Pago registrado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/sales/:id/cancel
 *  solo pending. Las completadas van por /api/returns
 * ========================================================= */
exports.cancelSale = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) return next(new AppError('Venta no encontrada', 404));

    if (!sale.canCancel()) {
      // Mensaje específico para redirigir a Módulo 8
      if (sale.status === 'completed') {
        return next(
          new AppError(
            'Esta venta ya fue completada. Para devoluciones o reembolsos use vaya al modulo correspondiente',
            400
          )
        );
      }
      if (['refunded', 'partially_refunded'].includes(sale.status)) {
        return next(
          new AppError(
            `No se puede cancelar una venta en estado '${sale.status}'. Use el modulo correspondiente para procesar devoluciones.`,
            400
          )
        );
      }
      return next(
        new AppError(`No se puede cancelar una venta en estado '${sale.status}'`, 400)
      );
    }

    const reason = req.body.reason || null;

    // Restaurar stock
    await stockService.restoreStockForCancellation(sale.items);

    // Revertir crédito del cliente (si aplica)
    if (sale.clientId) {
      const client = await Client.findById(sale.clientId);
      if (client) {
        const creditPayment = sale.payments.find((p) => p.method === 'credit');
        if (creditPayment) {
          try {
            client.addCreditMovement(
              'return',
              Number(creditPayment.amount),
              `Cancelación venta ${sale.saleNumber}`,
              { saleId: sale._id, createdBy: req.user._id }
            );
            await client.save();
          } catch (creditErr) {
            console.error(
              `⚠️  No se pudo revertir el crédito de la venta ${sale.saleNumber}:`,
              creditErr.message
            );
          }
        }

        const entry = client.purchaseHistory.find(
          (p) => p.saleId && p.saleId.equals(sale._id)
        );
        if (entry) {
          entry.status = 'cancelled';
          await client.save();
        }
      }
    }

    // Revertir métricas del vendedor
    if (sale.sellerId) {
      const seller = await Seller.findById(sale.sellerId);
      if (seller) {
        const commissionEntry = seller.commissionHistory.find(
          (e) => e.saleId && e.saleId.equals(sale._id) && !e.paid
        );
        if (commissionEntry) {
          seller.pendingCommission = Math.max(
            0,
            seller.pendingCommission - commissionEntry.amount
          );
          seller.totalCommission = Math.max(
            0,
            seller.totalCommission - commissionEntry.amount
          );
          seller.monthlyCommission = Math.max(
            0,
            seller.monthlyCommission - commissionEntry.amount
          );
          seller.commissionHistory.pull(commissionEntry._id);
        }

        seller.salesCount = Math.max(0, seller.salesCount - 1);
        seller.totalSales = Math.max(0, seller.totalSales - sale.total);
        seller.monthlySales = Math.max(0, seller.monthlySales - sale.total);
        await seller.save();
      }
    }

    // Cancelar partner splits
    try {
      await partnerSplitService.cancelSplitsForSale(sale._id);
    } catch (err) {
      console.error('⚠️  Cancel partner splits falló:', err.message);
    }

    sale.changeStatus('cancelled', {
      reason,
      cancelledBy: req.user._id,
    });
    await sale.save();

    res.status(200).json({
      success: true,
      data: {
        sale: {
          _id: sale._id,
          saleNumber: sale.saleNumber,
          status: sale.status,
          cancelledAt: sale.cancelledAt,
          cancellationReason: sale.cancellationReason,
        },
        stockRestored: sale.items.length,
      },
      message: 'Venta cancelada correctamente. Stock restaurado.',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/sales/summary  (admin)
 * ========================================================= */
exports.getSalesSummary = async (req, res, next) => {
  try {
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = req.query.to ? new Date(req.query.to) : new Date();

    const [totals, byChannel, byPaymentMethod] = await Promise.all([
      Sale.getTotalByPeriod(from, to),
      Sale.aggregate([
        {
          $match: {
            createdAt: { $gte: from, $lte: to },
            status: { $in: ['completed', 'pending', 'partially_refunded'] },
          },
        },
        {
          $group: {
            _id: '$channel',
            count: { $sum: 1 },
            total: { $sum: '$total' },
            returnedTotal: { $sum: '$returnedTotal' },   // 👈 NUEVO
          },
        },
      ]),
      Sale.aggregate([
        {
          $match: {
            createdAt: { $gte: from, $lte: to },
            status: { $in: ['completed', 'pending', 'partially_refunded'] },
          },
        },
        { $unwind: '$payments' },
        {
          $group: {
            _id: '$payments.method',
            count: { $sum: 1 },
            total: { $sum: '$payments.amount' },
          },
        },
        { $sort: { total: -1 } },
      ]),
    ]);

    res.status(200).json({
      success: true,
      data: {
        period: { from, to },
        totals,
        byChannel,
        byPaymentMethod,
      },
      message: 'Resumen de ventas obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/sales/top-products  (admin / partner)
 * ========================================================= */
exports.getTopProducts = async (req, res, next) => {
  try {
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const limit = Number(req.query.limit) || 10;

    const options = {};
    if (req.user.role === ROLES.PARTNER && req.user.partnerId) {
      options.partnerId = req.user.partnerId;
    }
    if (req.query.channel) options.channel = req.query.channel;

    const products = await Sale.getTopProducts(from, to, limit, options);

    res.status(200).json({
      success: true,
      data: { products, period: { from, to }, limit },
      message: 'Top productos obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/sales/stats  (admin)
 * ========================================================= */
exports.getSaleStats = async (req, res, next) => {
  try {
    const [byStatus, byPaymentStatus, recent30d, returnsAgg] = await Promise.all([
      Sale.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$total' } } },
      ]),
      Sale.aggregate([{ $group: { _id: '$paymentStatus', count: { $sum: 1 } } }]),
      Sale.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            status: { $in: ['completed', 'pending', 'partially_refunded'] },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            total: { $sum: '$total' },
            avgTicket: { $avg: '$total' },
            returnedTotal: { $sum: '$returnedTotal' },   // 👈 NUEVO
          },
        },
      ]),
      //métricas de devoluciones
      Sale.aggregate([
        { $match: { hasReturns: true } },
        {
          $group: {
            _id: null,
            salesWithReturns: { $sum: 1 },
            totalReturned: { $sum: '$returnedTotal' },
          },
        },
      ]),
    ]);

    res.status(200).json({
      success: true,
      data: {
        byStatus: byStatus.reduce((acc, r) => {
          acc[r._id] = { count: r.count, total: r.total };
          return acc;
        }, {}),
        byPaymentStatus: byPaymentStatus.reduce((acc, r) => {
          acc[r._id] = r.count;
          return acc;
        }, {}),
        last30Days: recent30d[0] || {
          count: 0,
          total: 0,
          avgTicket: 0,
          returnedTotal: 0,
        },
        returns: returnsAgg[0] || {
          salesWithReturns: 0,
          totalReturned: 0,
        },
      },
      message: 'Estadísticas de ventas obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};