const Promotion = require('../models/Promotion');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const promotionService = require('../services/promotionService');
const { paginate, formatPagination } = require('../utils/helpers');

/* =========================================================
 *  POST /api/promotions
 * ========================================================= */
exports.createPromotion = async (req, res, next) => {
  try {
    const payload = { ...req.body, createdBy: req.user._id };

    // Normalizar code si es cupón
    if (payload.type === 'coupon' && payload.code) {
      payload.code = payload.code.toUpperCase().trim();
      const existing = await Promotion.findOne({ code: payload.code });
      if (existing) {
        return next(new AppError('Ya existe una promoción con ese código', 400));
      }
    }

    const promotion = await Promotion.create(payload);

    res.status(201).json({
      success: true,
      data: promotion,
      message: 'Promoción creada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/promotions
 * ========================================================= */
exports.getPromotions = async (req, res, next) => {
  try {
    const { skip, limit: limitNum, page: pageNum } = paginate(
      req.query.page,
      req.query.limit
    );

    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.benefitType) filter.benefitType = req.query.benefitType;
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
    if (req.query.featured === 'true') filter.isFeatured = true;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { code: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const [promotions, total] = await Promise.all([
      Promotion.find(filter)
        .sort({ priority: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Promotion.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        promotions,
        pagination: formatPagination(total, pageNum, limitNum),
      },
      message: 'Promociones obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/promotions/active
 * ========================================================= */
exports.getActivePromotions = async (req, res, next) => {
  try {
    const channel = req.query.channel || 'pos';
    const promotions = await Promotion.getActivePromotions({ channel });
    res.status(200).json({
      success: true,
      data: { promotions, channel },
      message: 'Promociones activas obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/promotions/featured
 * ========================================================= */
exports.getFeaturedPromotions = async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 5;
    const promotions = await promotionService.getFeaturedPromotions(limit);
    res.status(200).json({
      success: true,
      data: { promotions },
      message: 'Promociones destacadas obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/promotions/by-code/:code
 * ========================================================= */
exports.getPromotionByCode = async (req, res, next) => {
  try {
    const promotion = await Promotion.getByCode(req.params.code);
    if (!promotion) {
      return next(new AppError('Promoción no encontrada para ese código', 404));
    }
    res.status(200).json({
      success: true,
      data: promotion,
      message: 'Promoción obtenida correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/promotions/by-product/:productId
 * ========================================================= */
exports.getPromotionsByProduct = async (req, res, next) => {
  try {
    const promotions = await promotionService.getProductPromotions(
      req.params.productId,
      { channel: req.query.channel }
    );
    res.status(200).json({
      success: true,
      data: { promotions, total: promotions.length },
      message: 'Promociones del producto obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/promotions/:id
 * ========================================================= */
exports.getPromotionById = async (req, res, next) => {
  try {
    const promotion = await Promotion.findById(req.params.id)
      .populate('applicableProducts', 'name barcode price')
      .populate('applicableCategories', 'name slug')
      .populate('createdBy', 'name email');
    if (!promotion) return next(new AppError('Promoción no encontrada', 404));

    res.status(200).json({
      success: true,
      data: promotion,
      message: 'Promoción obtenida correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/promotions/:id  (perfil only)
 * ========================================================= */
exports.updatePromotion = async (req, res, next) => {
  try {
    const forbidden = [
      'type',
      'code',
      'benefitType',
      'benefitValue',
      'buyXGetY',
      'usageCount',
      'usageByClient',
      'isActive',
    ];
    const attempted = forbidden.filter((f) => req.body[f] !== undefined);
    if (attempted.length > 0) {
      return next(
        new AppError(
          `Los campos '${attempted.join("', '")}' no se pueden modificar por esta ruta`,
          400
        )
      );
    }

    const promotion = await Promotion.findById(req.params.id);
    if (!promotion) return next(new AppError('Promoción no encontrada', 404));

    const allowed = [
      'name',
      'description',
      'priority',
      'maxDiscountAmount',
      'minPurchaseAmount',
      'applicableChannels',
      'applicableClientCategories',
      'applicableProducts',
      'applicableCategories',
      'applicableSizes',
      'applicableColors',
      'startDate',
      'endDate',
      'usageLimit',
      'usageLimitPerCustomer',
      'isStackable',
      'isFeatured',
    ];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) promotion[field] = req.body[field];
    });

    await promotion.save();

    res.status(200).json({
      success: true,
      data: promotion,
      message: 'Promoción actualizada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/promotions/:id/benefit
 * ========================================================= */
exports.updatePromotionBenefit = async (req, res, next) => {
  try {
    const promotion = await Promotion.findById(req.params.id);
    if (!promotion) return next(new AppError('Promoción no encontrada', 404));

    const { benefitType, benefitValue, buyXGetY, maxDiscountAmount } = req.body;

    promotion.benefitType = benefitType;
    promotion.benefitValue = benefitValue || 0;
    promotion.buyXGetY = buyXGetY || null;
    if (maxDiscountAmount !== undefined) {
      promotion.maxDiscountAmount = maxDiscountAmount;
    }

    await promotion.save();

    res.status(200).json({
      success: true,
      data: promotion,
      message: 'Beneficio de la promoción actualizado',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/promotions/:id/status
 * ========================================================= */
exports.togglePromotionStatus = async (req, res, next) => {
  try {
    const promotion = await Promotion.findById(req.params.id);
    if (!promotion) return next(new AppError('Promoción no encontrada', 404));

    const newStatus =
      req.body.isActive !== undefined ? !!req.body.isActive : !promotion.isActive;

    if (newStatus === promotion.isActive) {
      return res.status(200).json({
        success: true,
        data: promotion,
        message: `La promoción ya estaba ${promotion.isActive ? 'activa' : 'inactiva'}`,
      });
    }

    promotion.isActive = newStatus;
    await promotion.save();

    res.status(200).json({
      success: true,
      data: promotion,
      message: `Promoción ${newStatus ? 'activada' : 'desactivada'} correctamente`,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  DELETE /api/promotions/:id  (soft delete)
 * ========================================================= */
exports.deletePromotion = async (req, res, next) => {
  try {
    const promotion = await Promotion.findById(req.params.id);
    if (!promotion) return next(new AppError('Promoción no encontrada', 404));

    if (!promotion.isActive) {
      return next(new AppError('La promoción ya está desactivada', 400));
    }

    promotion.isActive = false;
    await promotion.save();

    res.status(200).json({
      success: true,
      data: promotion,
      message: 'Promoción desactivada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/promotions/preview
 *  Aplica promociones en memoria (sin crear venta)
 * ========================================================= */
exports.previewPromotions = async (req, res, next) => {
  try {
    const {
      items,
      subtotal,
      clientId,
      clientCategory,
      channel = 'pos',
      couponCodes = [],
    } = req.body;

    // Enriquecer items con datos de producto
    const enrichedItems = [];
    for (const item of items) {
      const product = await Product.findById(item.productId)
        .select('name price categoryId variants')
        .lean();
      if (!product) {
        return next(
          new AppError(`Producto no encontrado: ${item.productId}`, 404)
        );
      }
      const size = String(item.size || '').toUpperCase();
      const color = item.color || '';
      const variant = product.variants.find(
        (v) => v.size === size && v.color === color
      );
      const unitPrice =
        item.unitPrice !== undefined ? Number(item.unitPrice) : product.price;

      enrichedItems.push({
        productId: product._id,
        productName: product.name,
        categoryId: product.categoryId,
        sku: variant?.sku || null,
        size,
        color,
        quantity: Number(item.quantity),
        unitPrice,
      });
    }

    const computedSubtotal =
      subtotal !== undefined
        ? Number(subtotal)
        : enrichedItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

    const result = await promotionService.applyPromotions({
      items: enrichedItems,
      subtotal: computedSubtotal,
      clientId,
      clientCategory,
      channel,
      couponCodes,
    });

    res.status(200).json({
      success: true,
      data: {
        subtotal: computedSubtotal,
        totalDiscount: result.totalDiscount,
        finalTotal: result.finalTotal,
        appliedPromotions: result.appliedPromotions,
        invalidCoupons: result.invalidCoupons,
      },
      message: result.ok
        ? 'Promociones calculadas correctamente'
        : 'Uno o más cupones no son aplicables',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/promotions/validate-coupon
 * ========================================================= */
exports.validateCoupon = async (req, res, next) => {
  try {
    const { code, saleTotal, clientId, channel } = req.body;
    const result = await promotionService.validateCoupon(code, {
      saleTotal: Number(saleTotal),
      clientId,
      channel,
    });

    res.status(200).json({
      success: true,
      data: result,
      message: result.valid
        ? 'Cupón válido para esta venta'
        : `Cupón no válido: ${result.reason}`,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/promotions/stats
 * ========================================================= */
exports.getPromotionStats = async (req, res, next) => {
  try {
    const [counts, byType, topUsed] = await Promise.all([
      Promotion.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            featured: { $sum: { $cond: ['$isFeatured', 1, 0] } },
            totalUsages: { $sum: '$usageCount' },
          },
        },
      ]),
      Promotion.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      Promotion.find({ isActive: true })
        .sort({ usageCount: -1 })
        .limit(10)
        .select('name code type benefitType usageCount usagePercentage')
        .lean(),
    ]);

    const c = counts[0] || { total: 0, active: 0, featured: 0, totalUsages: 0 };

    res.status(200).json({
      success: true,
      data: {
        ...c,
        byType: byType.reduce((acc, r) => {
          acc[r._id] = r.count;
          return acc;
        }, {}),
        topUsed,
      },
      message: 'Estadísticas de promociones obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};