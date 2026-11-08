const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const { paginate, formatPagination } = require('../utils/helpers');
const { ROLES } = require('../config/roles');

const STAFF_ROLES = [ROLES.ADMIN, ROLES.PARTNER, ROLES.EMPLOYEE];

/* =========================================================
 *  Helpers internos
 * ========================================================= */
const isStaff = (user) => user && STAFF_ROLES.includes(user.role);
const isAdmin = (user) => user && user.role === ROLES.ADMIN;

const buildProductFilter = (query, user) => {
  const filter = {};
  const staff = isStaff(user);

  // isActive: público solo activos; staff puede filtrar
  if (staff && query.isActive !== undefined) {
    filter.isActive = query.isActive === 'true';
  } else {
    filter.isActive = true;
  }

  // isVisibleOnWeb: público solo visibles
  if (staff && query.isVisibleOnWeb !== undefined) {
    filter.isVisibleOnWeb = query.isVisibleOnWeb === 'true';
  } else if (!staff) {
    filter.isVisibleOnWeb = true;
  }

  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.supplierId) filter.supplierId = query.supplierId;
  if (query.partnerId) filter.partnerId = query.partnerId;
  if (query.isFeatured !== undefined) {
    filter.isFeatured = query.isFeatured === 'true';
  }

  if (query.minPrice || query.maxPrice) {
    filter.price = {};
    if (query.minPrice) filter.price.$gte = Number(query.minPrice);
    if (query.maxPrice) filter.price.$lte = Number(query.maxPrice);
  }

  if (query.tag) filter.tags = query.tag.toLowerCase();

  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { description: { $regex: query.search, $options: 'i' } },
      { tags: { $regex: query.search, $options: 'i' } },
    ];
  }

  if (query.inStock === 'true') {
    filter['variants.stock'] = { $gt: 0 };
  }

  return filter;
};

const buildProductSort = (sortBy) => {
  const map = {
    name: { name: 1 },
    '-name': { name: -1 },
    price: { price: 1 },
    '-price': { price: -1 },
    recent: { createdAt: -1 },
    featured: { isFeatured: -1, createdAt: -1 },
  };
  return map[sortBy] || { createdAt: -1 };
};

const buildProjection = (user) => (isStaff(user) ? '' : '-cost');

/* =========================================================
 *  GET /api/products
 * ========================================================= */
exports.getProducts = async (req, res, next) => {
  try {
    const { skip, limit: limitNum, page: pageNum } = paginate(
      req.query.page,
      req.query.limit
    );
    const filter = buildProductFilter(req.query, req.user);
    const sort = buildProductSort(req.query.sort);
    const projection = buildProjection(req.user);

    const [products, total] = await Promise.all([
      Product.find(filter)
        .select(projection)
        .populate('categoryId', 'name slug')
        .populate('supplierId', 'name')
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        products,
        pagination: formatPagination(total, pageNum, limitNum),
      },
      message: 'Productos obtenidos correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/products/:id
 * ========================================================= */
exports.getProductById = async (req, res, next) => {
  try {
    const query = { _id: req.params.id };
    if (!isStaff(req.user)) {
      query.isActive = true;
      query.isVisibleOnWeb = true;
    }

    const product = await Product.findOne(query)
      .select(buildProjection(req.user))
      .populate('categoryId', 'name slug level parentId')
      .populate('supplierId', 'name contactName');

    if (!product) {
      return next(new AppError('Producto no encontrado', 404));
    }

    res.status(200).json({
      success: true,
      data: product,
      message: 'Producto obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/products/by-barcode/:barcode  (staff)
 * ========================================================= */
exports.getProductByBarcode = async (req, res, next) => {
  try {
    const { barcode } = req.params;
    const product = await Product.findByBarcode(barcode)
      .populate('categoryId', 'name slug')
      .populate('supplierId', 'name');

    if (!product) {
      return next(
        new AppError(
          `Producto no encontrado para el código de barras '${barcode}'`,
          404
        )
      );
    }

    res.status(200).json({
      success: true,
      data: product,
      message: 'Producto obtenido por código de barras',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/products  (admin)
 * ========================================================= */
exports.createProduct = async (req, res, next) => {
  try {
    const {
      name,
      description,
      categoryId,
      supplierId,
      partnerId,
      price,
      webPrice,
      cost,
      isActive,
      isFeatured,
      isVisibleOnWeb,
      weightKg,
      tags,
      variants,
      images,
    } = req.body;

    const product = await Product.create({
      name,
      description,
      categoryId: categoryId || null,
      supplierId: supplierId || null,
      partnerId: partnerId || null,
      price,
      webPrice: webPrice !== undefined ? webPrice : null,
      cost: cost || 0,
      isActive: isActive !== undefined ? isActive : true,
      isFeatured: isFeatured !== undefined ? isFeatured : false,
      isVisibleOnWeb:
        isVisibleOnWeb !== undefined ? isVisibleOnWeb : true,
      weightKg: weightKg || 0,
      tags: tags || [],
      variants: variants || [],
      images: images || [],
    });

    res.status(201).json({
      success: true,
      data: product,
      message: 'Producto creado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/products/:id  (admin, perfil only)
 * ========================================================= */
exports.updateProduct = async (req, res, next) => {
  try {
    // Defensa adicional (el validator ya lo bloquea)
    const forbidden = ['variants', 'barcode', 'partnerId', 'isActive'];
    const attempted = forbidden.filter((f) => req.body[f] !== undefined);
    if (attempted.length > 0) {
      return next(
        new AppError(
          `Los campos '${attempted.join("', '")}' no se pueden modificar por esta ruta`,
          400
        )
      );
    }

    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Producto no encontrado', 404));

    const allowed = [
      'name',
      'description',
      'categoryId',
      'supplierId',
      'price',
      'webPrice',
      'cost',
      'isFeatured',
      'isVisibleOnWeb',
      'weightKg',
      'tags',
    ];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) product[field] = req.body[field];
    });

    await product.save();

    res.status(200).json({
      success: true,
      data: product,
      message: 'Producto actualizado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  DELETE /api/products/:id  (admin, soft delete)
 * ========================================================= */
exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Producto no encontrado', 404));

    if (!product.isActive) {
      return next(new AppError('El producto ya está desactivado', 400));
    }

    product.isActive = false;
    await product.save();

    res.status(200).json({
      success: true,
      data: product,
      message: 'Producto desactivado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/products/:id/status  (admin)
 * ========================================================= */
exports.toggleProductStatus = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Producto no encontrado', 404));

    const newStatus =
      req.body.isActive !== undefined
        ? !!req.body.isActive
        : !product.isActive;

    if (newStatus === product.isActive) {
      return res.status(200).json({
        success: true,
        data: product,
        message: `El producto ya estaba ${product.isActive ? 'activo' : 'inactivo'}`,
      });
    }

    product.isActive = newStatus;
    await product.save();

    res.status(200).json({
      success: true,
      data: product,
      message: `Producto ${newStatus ? 'activado' : 'desactivado'} correctamente`,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/products/:id/stock  (staff)
 * ========================================================= */
exports.updateStock = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Producto no encontrado', 404));

    if (!product.isActive) {
      return next(
        new AppError('No se puede modificar stock de un producto inactivo', 400)
      );
    }

    const { size, color, quantity, type } = req.body;
    const variant = product.updateStock(size, color, quantity, type);
    await product.save();

    res.status(200).json({
      success: true,
      data: {
        product,
        variant: {
          sku: variant.sku,
          size: variant.size,
          color: variant.color,
          stock: variant.stock,
          minStock: variant.minStock,
        },
        movement: { type, quantity: Number(quantity) },
      },
      message: `Stock actualizado (${type}: ${quantity})`,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/products/:id/stock/check  (staff)
 * ========================================================= */
exports.checkStock = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Producto no encontrado', 404));

    const { size, color, quantity = 1 } = req.query;
    const result = product.checkStock(size, color, Number(quantity));

    res.status(200).json({
      success: true,
      data: {
        productId: product._id,
        productName: product.name,
        size: String(size).toUpperCase(),
        color,
        requested: Number(quantity),
        ...result,
      },
      message: !result.found
        ? 'Variante no encontrada'
        : result.enough
        ? 'Stock suficiente'
        : `Stock insuficiente (disponible: ${result.stock})`,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/products/low-stock  (staff)
 * ========================================================= */
exports.getLowStockProducts = async (req, res, next) => {
  try {
    const { partnerId, limit = 50 } = req.query;
    // Partner/employee: forzar su propio partnerId (si aplica)
    const effectivePartnerId =
      req.user.role === ROLES.ADMIN ? partnerId : req.user.partnerId;

    const products = await Product.getLowStockProducts({
      partnerId: effectivePartnerId || undefined,
      limit: Number(limit),
    });

    res.status(200).json({
      success: true,
      data: { products, total: products.length },
      message:
        products.length > 0
          ? 'Productos con stock bajo obtenidos correctamente'
          : 'No hay productos con stock bajo',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/products/stats  (admin)
 * ========================================================= */
exports.getProductStats = async (req, res, next) => {
  try {
    const [countsAgg, stockAgg, byCategory, byPartner] = await Promise.all([
      Product.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            inactive: { $sum: { $cond: ['$isActive', 0, 1] } },
            featured: { $sum: { $cond: ['$isFeatured', 1, 0] } },
            visibleOnWeb: { $sum: { $cond: ['$isVisibleOnWeb', 1, 0] } },
          },
        },
      ]),
      Product.aggregate([
        { $match: { isActive: true } },
        {
          $project: {
            totalStock: { $sum: '$variants.stock' },
            inventoryValue: {
              $sum: {
                $map: {
                  input: '$variants',
                  as: 'v',
                  in: { $multiply: ['$$v.stock', { $ifNull: ['$cost', 0] }] },
                },
              },
            },
            lowStockVariants: {
              $filter: {
                input: '$variants',
                as: 'v',
                cond: { $lte: ['$$v.stock', '$$v.minStock'] },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            totalStock: { $sum: '$totalStock' },
            inventoryValue: { $sum: '$inventoryValue' },
            productsWithLowStock: {
              $sum: {
                $cond: [{ $gt: [{ $size: '$lowStockVariants' }, 0] }, 1, 0],
              },
            },
          },
        },
      ]),
      Product.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$categoryId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'categories',
            localField: '_id',
            foreignField: '_id',
            as: 'category',
          },
        },
        { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            categoryId: '$_id',
            categoryName: { $ifNull: ['$category.name', 'Sin categoría'] },
            count: 1,
          },
        },
      ]),
      Product.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$partnerId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const counts = countsAgg[0] || {
      total: 0,
      active: 0,
      inactive: 0,
      featured: 0,
      visibleOnWeb: 0,
    };
    const stock = stockAgg[0] || {
      totalStock: 0,
      inventoryValue: 0,
      productsWithLowStock: 0,
    };

    res.status(200).json({
      success: true,
      data: {
        counts,
        stock: {
          ...stock,
          inventoryValue: Number((stock.inventoryValue || 0).toFixed(2)),
        },
        topCategories: byCategory,
        byPartner: byPartner.map((p) => ({
          partnerId: p._id,
          scope: p._id ? 'partner' : 'global',
          count: p.count,
        })),
      },
      message: 'Estadísticas de productos obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/products/:id/images  (admin)
 * ========================================================= */
exports.addProductImage = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Producto no encontrado', 404));

    const { url, isMain } = req.body;
    const hasMain = product.images.some((i) => i.isMain);
    const newIsMain = isMain === true || !hasMain;

    if (newIsMain && hasMain) {
      product.images.forEach((i) => (i.isMain = false));
    }

    product.images.push({ url, isMain: newIsMain });
    await product.save();

    res.status(200).json({
      success: true,
      data: product,
      message: 'Imagen agregada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  DELETE /api/products/:id/images/:imageId  (admin)
 * ========================================================= */
exports.deleteProductImage = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Producto no encontrado', 404));

    const { imageId } = req.params;
    const image = product.images.id(imageId);
    if (!image) return next(new AppError('Imagen no encontrada', 404));

    const wasMain = image.isMain;
    product.images.pull(imageId);

    if (wasMain && product.images.length > 0) {
      product.images[0].isMain = true;
    }

    await product.save();

    res.status(200).json({
      success: true,
      data: product,
      message: 'Imagen eliminada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/products/:id/images/:imageId/main  (admin)
 * ========================================================= */
exports.setMainImage = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Producto no encontrado', 404));

    const { imageId } = req.params;
    const image = product.images.id(imageId);
    if (!image) return next(new AppError('Imagen no encontrada', 404));

    product.images.forEach((i) => (i.isMain = false));
    image.isMain = true;
    await product.save();

    res.status(200).json({
      success: true,
      data: product,
      message: 'Imagen principal actualizada correctamente',
    });
  } catch (error) {
    next(error);
  }
};