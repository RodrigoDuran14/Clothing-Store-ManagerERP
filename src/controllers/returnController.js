const Return = require('../models/Return');
const Sale = require('../models/Sale');
const Client = require('../models/Client');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const refundService = require('../services/refundService');
const { paginate, formatPagination } = require('../utils/helpers');
const { ROLES } = require('../config/roles');

/* =========================================================
 *  Helpers
 * ========================================================= */
const buildReturnFilter = (query, user) => {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  if (query.saleId) filter.saleId = query.saleId;
  if (query.clientId) filter.clientId = query.clientId;

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
      { returnNumber: { $regex: query.search, $options: 'i' } },
      { saleNumber: { $regex: query.search, $options: 'i' } },
    ];
  }

  return filter;
};

/**
 * Enriquecer un item de devolución con datos del producto y precio de la venta original.
 */
const enrichItem = async (rawItem, originalSale) => {
  const product = await Product.findById(rawItem.productId).lean();
  if (!product) {
    throw new AppError(`Producto no encontrado: ${rawItem.productId}`, 404);
  }

  const size = String(rawItem.size).toUpperCase();
  const color = rawItem.color;
  const variant = product.variants.find((v) => v.size === size && v.color === color);
  if (!variant) {
    throw new AppError(
      `Variante no encontrada en "${product.name}" (${size}/${color})`,
      400
    );
  }

  // Precio para REFUND: viene de la venta original
  const originalItem = originalSale.items.find(
    (i) =>
      i.productId.toString() === rawItem.productId.toString() &&
      i.size === size &&
      i.color === color
  );
  if (!originalItem) {
    throw new AppError(
      `El item "${product.name}" (${size}/${color}) no pertenece a la venta original`,
      400
    );
  }

  const quantity = Number(rawItem.quantity);
  const unitPrice = originalItem.unitPrice;
  const subtotal = Number((unitPrice * quantity).toFixed(2));

  return {
    productId: product._id,
    productName: product.name,
    productSku: variant.sku,
    size,
    color,
    quantity,
    unitPrice,
    subtotal,
    partnerId: originalItem.partnerId || product.partnerId || null,
  };
};

/**
 * Enriquecer un item de exchange. Usa el precio actual del producto.
 */
const enrichExchangeItem = async (rawItem) => {
  const product = await Product.findById(rawItem.productId).lean();
  if (!product) {
    throw new AppError(`Producto no encontrado: ${rawItem.productId}`, 404);
  }
  if (!product.isActive) {
    throw new AppError(`Producto inactivo: ${product.name}`, 400);
  }

  const size = String(rawItem.size).toUpperCase();
  const color = rawItem.color;
  const variant = product.variants.find((v) => v.size === size && v.color === color);
  if (!variant) {
    throw new AppError(
      `Variante no encontrada en "${product.name}" (${size}/${color})`,
      400
    );
  }

  const quantity = Number(rawItem.quantity);
  const unitPrice = product.price;
  const subtotal = Number((unitPrice * quantity).toFixed(2));

  return {
    productId: product._id,
    productName: product.name,
    productSku: variant.sku,
    size,
    color,
    quantity,
    unitPrice,
    subtotal,
    partnerId: product.partnerId || null,
  };
};

/**
 * Verifica que un partner solo vea sus devoluciones.
 */
const checkPartnerAccess = (returnDoc, user) => {
  if (user.role !== ROLES.PARTNER || !user.partnerId) return;
  const hasPartnerItem = returnDoc.items.some(
    (i) => i.partnerId && i.partnerId.equals(user.partnerId)
  );
  if (!hasPartnerItem) {
    throw new AppError('No tiene permisos para ver esta devolución', 403);
  }
};

/* =========================================================
 *  POST /api/returns  (staff)
 * ========================================================= */
exports.createReturn = async (req, res, next) => {
  try {
    const {
      saleId,
      type,
      items: rawItems,
      exchangeItems: rawExchangeItems = [],
      reasonType = 'other',
      reason,
      clientNotes,
      refundMethod,
    } = req.body;

    /* ---------- 1. Cargar y validar venta ---------- */
    const sale = await Sale.findById(saleId);
    if (!sale) return next(new AppError('Venta no encontrada', 404));

    if (!sale.canReturn()) {
      return next(
        new AppError(
          `La venta no admite devoluciones. Estado: '${sale.status}', pago: '${sale.paymentStatus}'`,
          400
        )
      );
    }

    /* ---------- 2. Validar período de devolución ---------- */
    const period = refundService.validateReturnPeriod(sale.createdAt);
    if (!period.valid) {
      return next(
        new AppError(
          `El período de devolución expiró. La venta fue realizada hace ${period.daysSinceSale} días (máx: ${period.maxDays})`,
          400
        )
      );
    }

    /* ---------- 3. Enriquecer items devueltos ---------- */
    const enrichedItems = [];
    for (const raw of rawItems) {
      const enriched = await enrichItem(raw, sale);

      // Validar disponibilidad para devolver
      const check = refundService.canReturnProduct(
        sale,
        enriched.productId,
        enriched.size,
        enriched.color,
        enriched.quantity
      );
      if (!check.canReturn) {
        return next(
          new AppError(
            `No se puede devolver ${enriched.quantity} de "${enriched.productName}" (${enriched.size}/${enriched.color}). ` +
              `Comprado: ${check.original}, ya devuelto: ${check.returned}, disponible: ${check.available}`,
            400
          )
        );
      }

      // Validar duplicados dentro del mismo payload
      const dup = enrichedItems.find(
        (i) =>
          i.productId.equals(enriched.productId) &&
          i.size === enriched.size &&
          i.color === enriched.color
      );
      if (dup) {
        return next(
          new AppError(
            `El item "${enriched.productName}" (${enriched.size}/${enriched.color}) está duplicado en el payload`,
            400
          )
        );
      }

      enrichedItems.push(enriched);
    }

    /* ---------- 4. Cálculo refund ---------- */
    const refund = refundService.calculateRefundAmount(enrichedItems, sale);

    /* ---------- 5. Exchange: enriquecer items nuevos ---------- */
    let enrichedExchangeItems = [];
    let exchangeAmounts = { subtotal: 0, tax: 0, total: 0 };
    let balanceDue = -refund.total; // solo devolución → tienda devuelve todo

    if (type === 'exchange') {
      for (const raw of rawExchangeItems) {
        const enriched = await enrichExchangeItem(raw);

        const dup = enrichedExchangeItems.find(
          (i) =>
            i.productId.equals(enriched.productId) &&
            i.size === enriched.size &&
            i.color === enriched.color
        );
        if (dup) {
          return next(
            new AppError(
              `El item de exchange "${enriched.productName}" (${enriched.size}/${enriched.color}) está duplicado`,
              400
            )
          );
        }

        enrichedExchangeItems.push(enriched);
      }

      const exchSubtotal = enrichedExchangeItems.reduce((s, i) => s + i.subtotal, 0);
      const exchTax = Number(((exchSubtotal * (sale.taxRate || 0)) / 100).toFixed(2));
      const exchTotal = Number((exchSubtotal + exchTax).toFixed(2));

      exchangeAmounts = {
        subtotal: exchSubtotal,
        tax: exchTax,
        total: exchTotal,
      };
      balanceDue = Number((exchTotal - refund.total).toFixed(2));
    }

    const resolvedRefundMethod = 
      type === 'refund'
        ? refundMethod || 'voucher'
        : refundMethod || null;

    /* ---------- 6. Crear Return ---------- */
    const returnDoc = await Return.create({
      saleId: sale._id,
      saleNumber: sale.saleNumber,
      clientId: sale.clientId || null,
      type,
      status: 'pending',
      items: enrichedItems,
      refundSubtotal: refund.subtotal,
      refundTax: refund.tax,
      refundTotal: refund.total,
      exchangeItems: enrichedExchangeItems,
      exchangeSubtotal: exchangeAmounts.subtotal,
      exchangeTax: exchangeAmounts.tax,
      exchangeTotal: exchangeAmounts.total,
      balanceDue,
      refundMethod: resolvedRefundMethod,
      reasonType,
      reason,
      clientNotes: clientNotes || null,
      createdBy: req.user._id,
      tracking: [
        {
          action: 'created',
          by: req.user._id,
          note: type === 'exchange' ? 'Cambio iniciado' : 'Devolución iniciada',
        },
      ],
    });

    res.status(201).json({
      success: true,
      data: {
        return: returnDoc,
        summary: {
          refundTotal: refund.total,
          exchangeTotal: exchangeAmounts.total,
          balanceDue,
          balanceLabel:
            balanceDue > 0
              ? `Cliente debe pagar $${balanceDue}`
              : balanceDue < 0
              ? `Tienda debe devolver $${Math.abs(balanceDue)}`
              : 'Sin diferencia',
        },
      },
      message:
        type === 'exchange'
          ? 'Cambio creado correctamente. Pendiente de aprobación.'
          : 'Devolución creada correctamente. Pendiente de aprobación.',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/returns
 * ========================================================= */
exports.getReturns = async (req, res, next) => {
  try {
    const { skip, limit: limitNum, page: pageNum } = paginate(
      req.query.page,
      req.query.limit
    );
    const filter = buildReturnFilter(req.query, req.user);

    const [returns, total] = await Promise.all([
      Return.find(filter)
        .populate('clientId', 'name phone')
        .populate('saleId', 'saleNumber total')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Return.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        returns,
        pagination: formatPagination(total, pageNum, limitNum),
      },
      message: 'Devoluciones obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/returns/:id
 * ========================================================= */
exports.getReturnById = async (req, res, next) => {
  try {
    const returnDoc = await Return.findById(req.params.id)
      .populate('clientId', 'name phone email')
      .populate('saleId', 'saleNumber total status createdAt')
      .populate('exchangeSaleId', 'saleNumber total status createdAt')
      .populate('createdBy', 'name email')
      .populate('approval.approvedBy', 'name')
      .populate('approval.rejectedBy', 'name')
      .populate('processedBy', 'name');

    if (!returnDoc) return next(new AppError('Devolución no encontrada', 404));

    checkPartnerAccess(returnDoc, req.user);

    res.status(200).json({
      success: true,
      data: returnDoc,
      message: 'Devolución obtenida correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/returns/by-number/:returnNumber
 * ========================================================= */
exports.getReturnByNumber = async (req, res, next) => {
  try {
    const returnDoc = await Return.findOne({
      returnNumber: req.params.returnNumber,
    })
      .populate('clientId', 'name phone email')
      .populate('saleId', 'saleNumber total status');
    if (!returnDoc) return next(new AppError('Devolución no encontrada', 404));

    checkPartnerAccess(returnDoc, req.user);

    res.status(200).json({
      success: true,
      data: returnDoc,
      message: 'Devolución obtenida correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/returns/by-client/:clientId
 * ========================================================= */
exports.getReturnsByClient = async (req, res, next) => {
  try {
    const { skip, limit: limitNum, page: pageNum } = paginate(
      req.query.page,
      req.query.limit
    );

    const filter = { clientId: req.params.clientId };

    const [returns, total] = await Promise.all([
      Return.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Return.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        returns,
        pagination: formatPagination(total, pageNum, limitNum),
      },
      message: 'Devoluciones del cliente obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/returns/:id/approve  (admin)
 * ========================================================= */
exports.approveReturn = async (req, res, next) => {
  try {
    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) return next(new AppError('Devolución no encontrada', 404));

    returnDoc.approve(req.user._id, req.body.notes || null);
    await returnDoc.save();

    res.status(200).json({
      success: true,
      data: returnDoc,
      message: 'Devolución aprobada correctamente. Lista para procesar.',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/returns/:id/reject  (admin)
 * ========================================================= */
exports.rejectReturn = async (req, res, next) => {
  try {
    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) return next(new AppError('Devolución no encontrada', 404));

    returnDoc.reject(req.user._id, req.body.rejectionReason);
    await returnDoc.save();

    res.status(200).json({
      success: true,
      data: returnDoc,
      message: 'Devolución rechazada',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/returns/:id/process  (admin)
 *  ← Aquí ocurre la magia: restaura stock, revierte comisión,
 *     ajusta splits y, si es exchange, crea la nueva venta.
 * ========================================================= */
exports.processReturn = async (req, res, next) => {
  try {
    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) return next(new AppError('Devolución no encontrada', 404));

    // Métodos de reembolso / cobro de diferencia
    if (req.body.refundMethod) {
      returnDoc.refundMethod = req.body.refundMethod;
    }
    if (req.body.refundReference) {
      returnDoc.refundDetails.reference = req.body.refundReference;
    }
    if (req.body.balancePaymentMethod) {
      returnDoc.balancePaymentMethod = req.body.balancePaymentMethod;
    }
    if (req.body.balancePaymentReference) {
      returnDoc.balancePaymentReference = req.body.balancePaymentReference;
    }

    const result = await refundService.processReturn(returnDoc, req.user);

    const populated = await Return.findById(result.returnDoc._id)
      .populate('clientId', 'name phone')
      .populate('saleId', 'saleNumber total status returnedTotal')
      .populate('exchangeSaleId', 'saleNumber total status');

    res.status(200).json({
      success: true,
      data: {
        return: populated,
        exchangeSale: result.exchangeSale
          ? {
              _id: result.exchangeSale._id,
              saleNumber: result.exchangeSale.saleNumber,
              total: result.exchangeSale.total,
              status: result.exchangeSale.status,
            }
          : null,
        originalSale: {
          _id: result.originalSale._id,
          saleNumber: result.originalSale.saleNumber,
          status: result.originalSale.status,
          returnedTotal: result.originalSale.returnedTotal,
          hasReturns: result.originalSale.hasReturns,
        },
        summary: {
          refundTotal: populated.refundTotal,
          exchangeTotal: populated.exchangeTotal,
          balanceDue: populated.balanceDue,
          commissionReversal: populated.commissionReversal,
        },
      },
      message:
        populated.type === 'exchange'
          ? `Cambio procesado correctamente. Venta nueva: ${populated.exchangeSaleNumber}`
          : 'Devolución procesada correctamente. Reembolso registrado.',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/returns/:id/cancel  (admin)
 * ========================================================= */
exports.cancelReturn = async (req, res, next) => {
  try {
    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) return next(new AppError('Devolución no encontrada', 404));

    returnDoc.cancel(req.user._id, req.body.reason || null);
    await returnDoc.save();

    res.status(200).json({
      success: true,
      data: returnDoc,
      message: 'Devolución cancelada',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/returns/stats  (admin)
 * ========================================================= */
exports.getReturnStats = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const stats = await Return.getReturnStats(from, to);

    res.status(200).json({
      success: true,
      data: stats,
      message: 'Estadísticas de devoluciones obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};