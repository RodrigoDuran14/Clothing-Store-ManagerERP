const Supplier = require('../models/Supplier');
const AppError = require('../utils/AppError');
const { paginate, formatPagination } = require('../utils/helpers');

/* =========================================================
 *  Helpers internos
 * ========================================================= */
const buildSupplierFilter = (query) => {
  const filter = {};

  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.taxCondition) filter.taxCondition = query.taxCondition;
  if (query.minRating) filter.rating = { $gte: Number(query.minRating) };
  if (query.hasDebt === 'true') filter.debt = { $gt: 0 };
  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { contactName: { $regex: query.search, $options: 'i' } },
      { email: { $regex: query.search, $options: 'i' } },
      { taxId: { $regex: query.search, $options: 'i' } },
    ];
  }

  return filter;
};

const buildSupplierSort = (sortBy) => {
  const map = {
    name: { name: 1 },
    '-name': { name: -1 },
    rating: { rating: -1, totalPurchases: -1 },
    '-rating': { rating: 1, name: 1 },
    debt: { debt: -1, name: 1 },
    '-debt': { debt: 1, name: 1 },
    purchases: { totalPurchases: -1, name: 1 },
    recent: { createdAt: -1 },
    'last-purchase': { lastPurchase: -1 },
  };
  return map[sortBy] || { name: 1 };
};

/* =========================================================
 *  GET /api/suppliers
 * ========================================================= */
exports.getSuppliers = async (req, res, next) => {
  try {
    const { skip, limit: limitNum, page: pageNum } = paginate(
      req.query.page,
      req.query.limit
    );
    const filter = buildSupplierFilter(req.query);
    const sort = buildSupplierSort(req.query.sort);

    const [suppliers, total] = await Promise.all([
      Supplier.find(filter).sort(sort).skip(skip).limit(limitNum).lean(),
      Supplier.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        suppliers,
        pagination: formatPagination(total, pageNum, limitNum),
      },
      message: 'Proveedores obtenidos correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/suppliers/:id
 * ========================================================= */
exports.getSupplierById = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return next(new AppError('Proveedor no encontrado', 404));

    res.status(200).json({
      success: true,
      data: supplier,
      message: 'Proveedor obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/suppliers
 * ========================================================= */
exports.createSupplier = async (req, res, next) => {
  try {
    const {
      name,
      contactName,
      phone,
      phone2,
      email,
      address,
      taxId,
      taxCondition,
      notes,
      suppliedProducts,
      rating,
      deliveryTime,
      paymentTerms,
      bankInfo,
      isActive,
    } = req.body;

    // Unicidad case-insensitive (usa collation del índice)
    const existing = await Supplier.findOne({ name }).collation({
      locale: 'es',
      strength: 2,
    });
    if (existing) {
      return next(
        new AppError('Ya existe un proveedor con ese nombre', 400)
      );
    }

    const supplier = await Supplier.create({
      name,
      contactName,
      phone,
      phone2,
      email,
      address,
      taxId,
      taxCondition,
      notes,
      suppliedProducts: suppliedProducts || [],
      rating,
      deliveryTime,
      paymentTerms,
      bankInfo,
      isActive: isActive !== undefined ? isActive : true,
      // debt, totalPurchases y lastPurchase empiezan en sus defaults
    });

    res.status(201).json({
      success: true,
      data: supplier,
      message: 'Proveedor creado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/suppliers/:id  (solo perfil)
 * ========================================================= */
exports.updateSupplier = async (req, res, next) => {
  try {
    // Defensa adicional (el validator ya lo bloquea)
    const forbidden = ['debt', 'totalPurchases', 'lastPurchase', 'suppliedProducts', 'isActive'];
    const attempted = forbidden.filter((f) => req.body[f] !== undefined);
    if (attempted.length > 0) {
      return next(
        new AppError(
          `Los campos '${attempted.join("', '")}' no se pueden modificar por esta ruta`,
          400
        )
      );
    }

    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return next(new AppError('Proveedor no encontrado', 404));

    // Nombre: si cambia, validar unicidad case-insensitive
    if (req.body.name !== undefined && req.body.name !== supplier.name) {
      const existing = await Supplier.findOne({
        _id: { $ne: supplier._id },
        name: req.body.name,
      }).collation({ locale: 'es', strength: 2 });
      if (existing) {
        return next(
          new AppError('Ya existe un proveedor con ese nombre', 400)
        );
      }
      supplier.name = req.body.name;
    }

    // Campos de perfil permitidos
    const allowed = [
      'contactName',
      'phone',
      'phone2',
      'email',
      'address',
      'taxId',
      'taxCondition',
      'notes',
      'rating',
      'deliveryTime',
      'paymentTerms',
    ];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) supplier[field] = req.body[field];
    });

    // bankInfo: merge (no reemplaza campos ausentes)
    if (req.body.bankInfo !== undefined) {
      supplier.bankInfo = {
        ...(supplier.bankInfo || {}),
        ...req.body.bankInfo,
      };
    }

    await supplier.save();

    res.status(200).json({
      success: true,
      data: supplier,
      message: 'Proveedor actualizado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  DELETE /api/suppliers/:id  (soft delete)
 * ========================================================= */
exports.deleteSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return next(new AppError('Proveedor no encontrado', 404));

    if (!supplier.isActive) {
      return next(new AppError('El proveedor ya está desactivado', 400));
    }

    if (supplier.debt > 0) {
      return next(
        new AppError(
          `No se puede desactivar un proveedor con deuda pendiente ($${supplier.debt})`,
          400
        )
      );
    }

    supplier.isActive = false;
    await supplier.save();

    res.status(200).json({
      success: true,
      data: supplier,
      message: 'Proveedor desactivado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/suppliers/:id/status
 * ========================================================= */
exports.toggleSupplierStatus = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return next(new AppError('Proveedor no encontrado', 404));

    const newStatus =
      req.body.isActive !== undefined
        ? !!req.body.isActive
        : !supplier.isActive;

    if (newStatus === supplier.isActive) {
      return res.status(200).json({
        success: true,
        data: supplier,
        message: `El proveedor ya estaba ${supplier.isActive ? 'activo' : 'inactivo'}`,
      });
    }

    if (!newStatus && supplier.debt > 0) {
      return next(
        new AppError(
          `No se puede desactivar un proveedor con deuda pendiente ($${supplier.debt})`,
          400
        )
      );
    }

    supplier.isActive = newStatus;
    await supplier.save();

    res.status(200).json({
      success: true,
      data: supplier,
      message: `Proveedor ${newStatus ? 'activado' : 'desactivado'} correctamente`,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/suppliers/stats
 * ========================================================= */
exports.getSupplierStats = async (req, res, next) => {
  try {
    const [counts, byRatingAgg, debtAgg] = await Promise.all([
      Supplier.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            inactive: { $sum: { $cond: ['$isActive', 0, 1] } },
          },
        },
      ]),
      Supplier.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
        { $sort: { _id: -1 } },
      ]),
      Supplier.aggregate([
        {
          $group: {
            _id: null,
            totalDebt: { $sum: '$debt' },
            suppliersWithDebt: {
              $sum: { $cond: [{ $gt: ['$debt', 0] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    const base = counts[0] || { total: 0, active: 0, inactive: 0 };
    const debt = debtAgg[0] || { totalDebt: 0, suppliersWithDebt: 0 };
    const byRating = byRatingAgg.reduce((acc, row) => {
      acc[`${row._id}_estrellas`] = row.count;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: {
        total: base.total,
        active: base.active,
        inactive: base.inactive,
        totalDebt: debt.totalDebt,
        suppliersWithDebt: debt.suppliersWithDebt,
        byRating,
      },
      message: 'Estadísticas de proveedores obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/suppliers/top?limit=5&sortBy=rating
 * ========================================================= */
exports.getTopSuppliers = async (req, res, next) => {
  try {
    const { limit = 5, sortBy = 'rating' } = req.query;

    if (!['rating', 'purchases', 'debt'].includes(sortBy)) {
      return next(
        new AppError(
          "sortBy inválido. Use 'rating', 'purchases' o 'debt'",
          400
        )
      );
    }

    const suppliers = await Supplier.getTopSuppliers(Number(limit), sortBy);

    res.status(200).json({
      success: true,
      data: { suppliers, sortBy, limit: Number(limit) },
      message: 'Top proveedores obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/suppliers/by-product/:productId
 * ========================================================= */
exports.getSuppliersByProduct = async (req, res, next) => {
  try {
    const suppliers = await Supplier.findByProduct(req.params.productId);

    res.status(200).json({
      success: true,
      data: { suppliers, total: suppliers.length },
      message:
        suppliers.length > 0
          ? 'Proveedores del producto obtenidos correctamente'
          : 'No hay proveedores activos asociados a este producto',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/suppliers/:id/products
 * ========================================================= */
exports.addProductToSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return next(new AppError('Proveedor no encontrado', 404));

    const { productId } = req.body;
    const alreadyLinked = supplier.suppliedProducts.some(
      (p) => p.toString() === productId
    );

    if (alreadyLinked) {
      return res.status(200).json({
        success: true,
        data: supplier,
        message: 'El producto ya estaba asociado a este proveedor',
      });
    }

    await supplier.addProduct(productId);

    res.status(200).json({
      success: true,
      data: supplier,
      message: 'Producto asociado al proveedor correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  DELETE /api/suppliers/:id/products/:productId
 * ========================================================= */
exports.removeProductFromSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return next(new AppError('Proveedor no encontrado', 404));

    const { productId } = req.params;
    const linked = supplier.suppliedProducts.some(
      (p) => p.toString() === productId
    );

    if (!linked) {
      return next(
        new AppError('El producto no está asociado a este proveedor', 404)
      );
    }

    await supplier.removeProduct(productId);

    res.status(200).json({
      success: true,
      data: supplier,
      message: 'Producto desasociado del proveedor correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/suppliers/:id/purchases
 * ========================================================= */
exports.recordPurchase = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return next(new AppError('Proveedor no encontrado', 404));

    if (!supplier.isActive) {
      return next(
        new AppError(
          'No se puede registrar una compra a un proveedor inactivo',
          400
        )
      );
    }

    const { amount, paid = 0 } = req.body;
    await supplier.recordPurchase(Number(amount), Number(paid));

    res.status(200).json({
      success: true,
      data: supplier,
      message: 'Compra registrada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/suppliers/:id/debt
 *  Body: { amount: number }   (+ aumenta, - reduce)
 * ========================================================= */
exports.updateDebt = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return next(new AppError('Proveedor no encontrado', 404));

    const { amount } = req.body;
    await supplier.updateDebt(Number(amount));

    res.status(200).json({
      success: true,
      data: supplier,
      message:
        Number(amount) > 0
          ? 'Deuda incrementada correctamente'
          : 'Deuda reducida correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/suppliers/financial-summary
 * ========================================================= */
exports.getFinancialSummary = async (req, res, next) => {
  try {
    const [agg] = await Supplier.aggregate([
      {
        $group: {
          _id: null,
          totalDebt: { $sum: '$debt' },
          totalPurchasesCount: { $sum: '$totalPurchases' },
          avgRating: { $avg: '$rating' },
          suppliersWithDebt: {
            $sum: { $cond: [{ $gt: ['$debt', 0] }, 1, 0] },
          },
          totalSuppliers: { $sum: 1 },
          activeSuppliers: { $sum: { $cond: ['$isActive', 1, 0] } },
        },
      },
    ]);

    const topDebtors = await Supplier.find({
      isActive: true,
      debt: { $gt: 0 },
    })
      .sort({ debt: -1 })
      .limit(5)
      .select('name debt rating contactName phone')
      .lean();

    const topBuyers = await Supplier.find({ isActive: true })
      .sort({ totalPurchases: -1 })
      .limit(5)
      .select('name totalPurchases debt rating')
      .lean();

    const summary = agg || {
      totalDebt: 0,
      totalPurchasesCount: 0,
      avgRating: 0,
      suppliersWithDebt: 0,
      totalSuppliers: 0,
      activeSuppliers: 0,
    };

    res.status(200).json({
      success: true,
      data: {
        ...summary,
        avgRating: Number((summary.avgRating || 0).toFixed(2)),
        topDebtors,
        topBuyers,
      },
      message: 'Resumen financiero obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};