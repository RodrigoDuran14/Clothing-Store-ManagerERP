const Voucher = require('../models/Voucher');
const AppError = require('../utils/AppError');
const voucherService = require('../services/voucherService');
const { paginate, formatPagination } = require('../utils/helpers');

/* =========================================================
 *  POST /api/vouchers
 * ========================================================= */
exports.createVoucher = async (req, res, next) => {
  try {
    const voucher = await voucherService.issueVoucher({
      ...req.body,
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      data: voucher,
      message: 'Voucher creado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/vouchers/bulk
 * ========================================================= */
exports.createBulkVouchers = async (req, res, next) => {
  try {
    const { template, count } = req.body;
    const vouchers = await voucherService.issueBulkVouchers(
      template,
      count,
      req.user._id
    );

    res.status(201).json({
      success: true,
      data: {
        count: vouchers.length,
        vouchers: vouchers.map((v) => ({
          _id: v._id,
          code: v.code,
          originalAmount: v.originalAmount,
          expiresAt: v.expiresAt,
        })),
      },
      message: `${vouchers.length} vouchers creados correctamente`,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/vouchers
 * ========================================================= */
exports.getVouchers = async (req, res, next) => {
  try {
    const { skip, limit: limitNum, page: pageNum } = paginate(
      req.query.page,
      req.query.limit
    );

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.clientId) filter.clientId = req.query.clientId;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }
    if (req.query.search) {
      filter.$or = [
        { code: { $regex: req.query.search, $options: 'i' } },
        { issuedTo: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const [vouchers, total] = await Promise.all([
      Voucher.find(filter)
        .populate('clientId', 'name phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Voucher.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        vouchers,
        pagination: formatPagination(total, pageNum, limitNum),
      },
      message: 'Vouchers obtenidos correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/vouchers/stats
 * ========================================================= */
exports.getVoucherStats = async (req, res, next) => {
  try {
    const summary = await voucherService.getVoucherSummary({
      from: req.query.from,
      to: req.query.to,
      type: req.query.type,
      status: req.query.status,
    });

    res.status(200).json({
      success: true,
      data: summary,
      message: 'Estadísticas de vouchers obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/vouchers/by-code/:code
 * ========================================================= */
exports.getVoucherByCode = async (req, res, next) => {
  try {
    const voucher = await voucherService.findByCode(req.params.code);

    res.status(200).json({
      success: true,
      data: {
        _id: voucher._id,
        code: voucher.code,
        barcode: voucher.barcode,
        type: voucher.type,
        status: voucher.status,
        originalAmount: voucher.originalAmount,
        remainingAmount: voucher.remainingAmount,
        expiresAt: voucher.expiresAt,
        isRedeemable: voucher.isRedeemable,
        isExpired: voucher.isExpired,
        minimumPurchase: voucher.minimumPurchase,
        isStackable: voucher.isStackable,
        clientId: voucher.clientId,
        issuedTo: voucher.issuedTo,
      },
      message: 'Voucher obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/vouchers/by-barcode/:barcode
 * ========================================================= */
exports.getVoucherByBarcode = async (req, res, next) => {
  try {
    const voucher = await voucherService.findByBarcode(req.params.barcode);

    res.status(200).json({
      success: true,
      data: {
        _id: voucher._id,
        code: voucher.code,
        barcode: voucher.barcode,
        type: voucher.type,
        status: voucher.status,
        originalAmount: voucher.originalAmount,
        remainingAmount: voucher.remainingAmount,
        expiresAt: voucher.expiresAt,
        isRedeemable: voucher.isRedeemable,
        isExpired: voucher.isExpired,
        minimumPurchase: voucher.minimumPurchase,
        isStackable: voucher.isStackable,
        clientId: voucher.clientId,
        issuedTo: voucher.issuedTo,
      },
      message: 'Voucher obtenido correctamente por código de barras',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/vouchers/by-client/:clientId
 * ========================================================= */
exports.getVouchersByClient = async (req, res, next) => {
  try {
    const filter = { clientId: req.params.clientId };
    if (req.query.status) filter.status = req.query.status;
    else filter.status = 'active';

    const vouchers = await Voucher.find(filter).sort({
      expiresAt: 1,
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      data: { vouchers, total: vouchers.length },
      message: 'Vouchers del cliente obtenidos correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/vouchers/validate
 *  Validación sin redención (dry-run del POS)
 * ========================================================= */
exports.validateVouchers = async (req, res, next) => {
  try {
    const { codes, saleTotal, channel, clientId, productIds, categoryIds } = req.body;

    const saleContext = {
      total: Number(saleTotal),
      channel,
      clientId,
      productIds: productIds || [],
      categoryIds: categoryIds || [],
    };

    const result = await voucherService.validateMultipleForSale(codes, saleContext);

    res.status(200).json({
      success: true,
      data: {
        valid: result.valid,
        vouchers: result.vouchers.map((v) => ({
          code: v.code,
          type: v.type,
          remainingAmount: v.remainingAmount,
          isStackable: v.isStackable,
          expiresAt: v.expiresAt,
        })),
        totalAvailable: result.totalAvailable,
        maxApplicable: Math.min(result.totalAvailable, saleTotal),
        issues: result.issues,
      },
      message: result.valid
        ? 'Vouchers válidos para la venta'
        : 'Uno o más vouchers no son aplicables',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/vouchers/:id
 * ========================================================= */
exports.getVoucherById = async (req, res, next) => {
  try {
    const voucher = await Voucher.findById(req.params.id)
      .populate('clientId', 'name phone email')
      .populate('createdBy', 'name')
      .populate('returnId', 'returnNumber type status')
      .populate('issuedSaleId', 'saleNumber total')
      .populate('redemptions.saleId', 'saleNumber total createdAt')
      .populate('redemptions.redeemedBy', 'name');

    if (!voucher) return next(new AppError('Voucher no encontrado', 404));

    res.status(200).json({
      success: true,
      data: voucher,
      message: 'Voucher obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/vouchers/:id/cancel
 * ========================================================= */
exports.cancelVoucher = async (req, res, next) => {
  try {
    const voucher = await Voucher.findById(req.params.id);
    if (!voucher) return next(new AppError('Voucher no encontrado', 404));

    voucher.cancel(req.user._id, req.body.reason);
    await voucher.save();

    res.status(200).json({
      success: true,
      data: voucher,
      message: 'Voucher cancelado correctamente',
    });
  } catch (error) {
    next(error);
  }
};