const Seller = require('../models/Seller');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { paginate, formatPagination } = require('../utils/helpers');
const commissionService = require('../services/commissionService');
const { ROLES } = require('../config/roles');

/* =========================================================
 *  Helpers
 * ========================================================= */
const buildSellerFilter = (query) => {
  const filter = {};
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.role) filter.role = query.role;
  if (query.partnerId) filter.partnerId = query.partnerId;
  if (query.search) {
    filter.$or = [
      { displayName: { $regex: query.search, $options: 'i' } },
      { employeeCode: { $regex: query.search, $options: 'i' } },
    ];
  }
  return filter;
};

/**
 * Valida que el usuario pueda ser vendedor.
 * Solo roles employee y partner.
 */
const assertUserCanBeSeller = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError('Usuario no encontrado', 404);
  if (!user.isActive) {
    throw new AppError('El usuario está desactivado', 400);
  }
  if (user.role !== ROLES.EMPLOYEE && user.role !== ROLES.PARTNER) {
    throw new AppError(
      `Solo usuarios con rol 'employee' o 'partner' pueden ser vendedores. Rol actual: '${user.role}'`,
      400
    );
  }
  const existing = await Seller.findOne({ userId: user._id });
  if (existing) {
    throw new AppError('Este usuario ya tiene un registro de vendedor', 400);
  }
  return user;
};

/**
 * Verifica que el rol permita comisiones.
 * Si es partner y el body trae configuración de comisión no nula → 400.
 */
const assertCommissionAllowed = (role, body) => {
  if (role === ROLES.PARTNER) {
    const triesCommission =
      (body.commissionRate !== undefined && Number(body.commissionRate) > 0) ||
      (body.fixedCommissionAmount !== undefined &&
        Number(body.fixedCommissionAmount) > 0) ||
      (body.commissionTiers !== undefined &&
        Array.isArray(body.commissionTiers) &&
        body.commissionTiers.length > 0);

    if (triesCommission) {
      throw new AppError(
        'Los partners no reciben comisiones. Deje los campos de comisión en cero o vacíos.',
        400
      );
    }
  }
};

/* =========================================================
 *  GET /api/sellers
 * ========================================================= */
exports.getSellers = async (req, res, next) => {
  try {
    const { skip, limit: limitNum, page: pageNum } = paginate(
      req.query.page,
      req.query.limit
    );
    const filter = buildSellerFilter(req.query);

    const [sellers, total] = await Promise.all([
      Seller.find(filter)
        .sort({ totalSales: -1, displayName: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean({ virtuals: true }),
      Seller.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: { sellers, pagination: formatPagination(total, pageNum, limitNum) },
      message: 'Vendedores obtenidos correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/sellers/:id
 * ========================================================= */
exports.getSellerById = async (req, res, next) => {
  try {
    const seller = await Seller.findById(req.params.id)
      .populate('userId', 'name email role phone image');
    if (!seller) return next(new AppError('Vendedor no encontrado', 404));

    res.status(200).json({
      success: true,
      data: seller,
      message: 'Vendedor obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/sellers
 * ========================================================= */
exports.createSeller = async (req, res, next) => {
  try {
    const { userId, employeeCode, shifts, notes } = req.body;

    // 1. Validar usuario base
    const user = await assertUserCanBeSeller(userId);

    // 2. Si es partner, rechazar configuración de comisión
    assertCommissionAllowed(user.role, req.body);

    // 3. Crear Seller
    const seller = await Seller.create({
      userId: user._id,
      role: user.role,
      displayName: user.name,
      employeeCode: employeeCode || null,
      partnerId: user.partnerId || null,
      shifts: shifts || [],
      commissionType: user.role === 'partner' ? 'percentage' : (req.body.commissionType || 'percentage'),
      commissionRate: user.role === 'partner' ? 0 : (req.body.commissionRate || 0),
      fixedCommissionAmount: user.role === 'partner' ? 0 : (req.body.fixedCommissionAmount || 0),
      commissionTiers: user.role === 'partner' ? [] : (req.body.commissionTiers || []),
      notes: notes || null,
    });

    res.status(201).json({
      success: true,
      data: seller,
      message:
        user.role === 'partner'
          ? 'Vendedor (partner) creado correctamente. No genera comisiones.'
          : 'Vendedor creado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/sellers/:id  (perfil only)
 * ========================================================= */
exports.updateSeller = async (req, res, next) => {
  try {
    const forbidden = [
      'userId',
      'role',
      'commissionType',
      'commissionRate',
      'fixedCommissionAmount',
      'commissionTiers',
      'shifts',
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

    const seller = await Seller.findById(req.params.id);
    if (!seller) return next(new AppError('Vendedor no encontrado', 404));

    const allowed = ['employeeCode', 'notes'];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) seller[field] = req.body[field];
    });

    await seller.save();

    res.status(200).json({
      success: true,
      data: seller,
      message: 'Vendedor actualizado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/sellers/:id/status
 * ========================================================= */
exports.toggleSellerStatus = async (req, res, next) => {
  try {
    const seller = await Seller.findById(req.params.id);
    if (!seller) return next(new AppError('Vendedor no encontrado', 404));

    const newStatus =
      req.body.isActive !== undefined ? !!req.body.isActive : !seller.isActive;

    if (newStatus === seller.isActive) {
      return res.status(200).json({
        success: true,
        data: seller,
        message: `El vendedor ya estaba ${seller.isActive ? 'activo' : 'inactivo'}`,
      });
    }

    // No desactivar si tiene comisiones pendientes
    if (!newStatus && seller.pendingCommission > 0) {
      return next(
        new AppError(
          `No se puede desactivar un vendedor con comisiones pendientes ($${seller.pendingCommission}). Páguelas primero.`,
          400
        )
      );
    }

    seller.isActive = newStatus;
    await seller.save();

    res.status(200).json({
      success: true,
      data: seller,
      message: `Vendedor ${newStatus ? 'activado' : 'desactivado'} correctamente`,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  COMMISSION CONFIG
 * ========================================================= */
exports.updateCommissionConfig = async (req, res, next) => {
  try {
    const seller = await Seller.findById(req.params.id);
    if (!seller) return next(new AppError('Vendedor no encontrado', 404));

    // 🚫 El guard principal: partners no reciben comisiones
    if (seller.role === 'partner') {
      return next(
        new AppError(
          'Los partners no reciben comisiones. Esta configuración solo aplica a employees.',
          400
        )
      );
    }

    const { commissionType, commissionRate, fixedCommissionAmount, commissionTiers } =
      req.body;

    seller.commissionType = commissionType;
    seller.commissionRate = commissionRate || 0;
    seller.fixedCommissionAmount = fixedCommissionAmount || 0;
    seller.commissionTiers = commissionTiers || [];

    await seller.save();

    res.status(200).json({
      success: true,
      data: seller,
      message: 'Configuración de comisiones actualizada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  SHIFTS
 * ========================================================= */
exports.addShift = async (req, res, next) => {
  try {
    const seller = await Seller.findById(req.params.id);
    if (!seller) return next(new AppError('Vendedor no encontrado', 404));

    const { name, daysOfWeek, startTime, endTime, isActive } = req.body;

    seller.shifts.push({
      name,
      daysOfWeek,
      startTime,
      endTime,
      isActive: isActive !== undefined ? isActive : true,
    });

    await seller.save();

    res.status(201).json({
      success: true,
      data: seller.shifts,
      message: 'Turno agregado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

exports.updateShift = async (req, res, next) => {
  try {
    const seller = await Seller.findById(req.params.id);
    if (!seller) return next(new AppError('Vendedor no encontrado', 404));

    const shift = seller.shifts.id(req.params.shiftId);
    if (!shift) return next(new AppError('Turno no encontrado', 404));

    const allowed = ['name', 'daysOfWeek', 'startTime', 'endTime', 'isActive'];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) shift[field] = req.body[field];
    });

    await seller.save();

    res.status(200).json({
      success: true,
      data: seller.shifts,
      message: 'Turno actualizado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/sellers/:id/shifts/:shiftId/toggle
 *  Activa/desactiva un turno (soft delete).
 *  Acepta `isActive` explícito en body para operaciones idempotentes;
 *  si no viene, hace toggle.
 * ========================================================= */
exports.toggleShift = async (req, res, next) => {
  try {
    const seller = await Seller.findById(req.params.id);
    if (!seller) return next(new AppError('Vendedor no encontrado', 404));

    const shift = seller.shifts.id(req.params.shiftId);
    if (!shift) return next(new AppError('Turno no encontrado', 404));

    const newStatus =
      req.body.isActive !== undefined ? !!req.body.isActive : !shift.isActive;

    // Idempotencia: si no cambia nada, responde 200 sin tocar la DB
    if (newStatus === shift.isActive) {
      return res.status(200).json({
        success: true,
        data: {
          shift,
          allShifts: seller.shifts,
          activeCount: seller.shifts.filter((s) => s.isActive).length,
        },
        message: `El turno ya estaba ${shift.isActive ? 'activo' : 'inactivo'}`,
      });
    }

    shift.isActive = newStatus;
    await seller.save();

    res.status(200).json({
      success: true,
      data: {
        shift,
        allShifts: seller.shifts,
        activeCount: seller.shifts.filter((s) => s.isActive).length,
      },
      message: `Turno ${newStatus ? 'restaurado' : 'desactivado'} correctamente`,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  RECORD SALE (interno / POS)
 * ========================================================= */
exports.recordSale = async (req, res, next) => {
  try {
    const seller = await Seller.findById(req.params.id);
    if (!seller) return next(new AppError('Vendedor no encontrado', 404));
    if (!seller.isActive) {
      return next(new AppError('El vendedor está desactivado', 400));
    }

    const { amount, saleId } = req.body;
    seller.recordSale({ amount: Number(amount), saleId });
    await seller.save();

    res.status(200).json({
      success: true,
      data: {
        sellerId: seller._id,
        salesCount: seller.salesCount,
        totalSales: seller.totalSales,
        pendingCommission: seller.hasCommission()
          ? seller.pendingCommission
          : 0,
        hasCommission: seller.hasCommission(),
      },
      message: seller.hasCommission()
        ? 'Venta registrada y comisión generada'
        : 'Venta registrada (partner sin comisión)',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  COMMISSION payments
 * ========================================================= */
exports.registerCommissionPayment = async (req, res, next) => {
  try {
    const { amount, period, paymentMethod, paymentReference } = req.body;
    const seller = await commissionService.processCommissionPayment(
      req.params.id,
      Number(amount),
      { period, paymentMethod, paymentReference }
    );

    res.status(200).json({
      success: true,
      data: {
        sellerId: seller._id,
        paidCommission: seller.paidCommission,
        pendingCommission: seller.pendingCommission,
        lastCommissionPaymentDate: seller.lastCommissionPaymentDate,
      },
      message: 'Pago de comisión registrado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  SUMMARIES
 * ========================================================= */
exports.getCommissionSummary = async (req, res, next) => {
  try {
    const summary = await commissionService.getSellerCommissionSummary(
      req.params.id,
      { period: req.query.period }
    );
    res.status(200).json({
      success: true,
      data: summary,
      message: summary.hasCommission
        ? 'Resumen de comisiones obtenido correctamente'
        : 'Este vendedor es partner y no genera comisiones',
    });
  } catch (error) {
    next(error);
  }
};

exports.getCommissionReport = async (req, res, next) => {
  try {
    const { period, from, to } = req.query;
    const report = await commissionService.generateCommissionReport({
      period,
      from,
      to,
    });
    res.status(200).json({
      success: true,
      data: report,
      message: 'Reporte de comisiones generado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

exports.getTopSellers = async (req, res, next) => {
  try {
    const { limit = 5, partnerId, role } = req.query;
    const sellers = await Seller.getTopSellers(Number(limit), {
      partnerId,
      role,
    });
    res.status(200).json({
      success: true,
      data: { sellers, limit: Number(limit) },
      message: 'Top vendedores obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  STATS
 * ========================================================= */
exports.getSellerStats = async (req, res, next) => {
  try {
    const [counts, byRole] = await Promise.all([
      Seller.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            inactive: { $sum: { $cond: ['$isActive', 0, 1] } },
            withPendingCommission: {
              $sum: { $cond: [{ $gt: ['$pendingCommission', 0] }, 1, 0] },
            },
            totalPendingCommission: { $sum: '$pendingCommission' },
            totalPaidCommission: { $sum: '$paidCommission' },
            totalSales: { $sum: '$totalSales' },
          },
        },
      ]),
      Seller.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$role', count: { $sum: 1 } } },
      ]),
    ]);

    const c = counts[0] || {
      total: 0,
      active: 0,
      inactive: 0,
      withPendingCommission: 0,
      totalPendingCommission: 0,
      totalPaidCommission: 0,
      totalSales: 0,
    };

    res.status(200).json({
      success: true,
      data: {
        ...c,
        byRole: byRole.reduce((acc, r) => {
          acc[r._id] = r.count;
          return acc;
        }, {}),
      },
      message: 'Estadísticas de vendedores obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};