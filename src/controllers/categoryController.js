const Category = require('../models/Category');
const AppError = require('../utils/AppError');
const { paginate, formatPagination } = require('../utils/helpers');

/* =========================================================
 *  Helper: construir filtro a partir de query params
 * ========================================================= */
const buildCategoryFilter = (query, { defaultActiveOnly = true } = {}) => {
  const filter = {};

  const { partnerId } = query;
  if (!partnerId || partnerId === 'global' || partnerId === 'all') {
    filter.partnerId = null;
  } else {
    filter.partnerId = { $in: [partnerId, null] };
  }

  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  else if (defaultActiveOnly) filter.isActive = true;

  if (query.isFeatured !== undefined) {
    filter.isFeatured = query.isFeatured === 'true';
  }
  if (query.level !== undefined) filter.level = Number(query.level);
  if (query.parentId !== undefined) {
    filter.parentId = query.parentId === 'null' ? null : query.parentId;
  }
  if (query.search) {
    filter.name = { $regex: query.search, $options: 'i' };
  }

  return filter;
};

/* =========================================================
 *  GET /api/categories
 * ========================================================= */
exports.getCategories = async (req, res, next) => {
  try {
    const { tree, forSelect } = req.query;
    const filter = buildCategoryFilter(req.query);

    if (tree === 'true') {
      const treeData = await Category.getCategoryTree(filter);
      return res.status(200).json({
        success: true,
        data: { tree: treeData },
        message: 'Árbol de categorías obtenido correctamente',
      });
    }

    if (forSelect === 'true') {
      const options = await Category.getForSelect(filter);
      return res.status(200).json({
        success: true,
        data: { options },
        message: 'Categorías para selección obtenidas correctamente',
      });
    }

    const { skip, limit: limitNum, page: pageNum } = paginate(
      req.query.page,
      req.query.limit
    );

    const [categories, total] = await Promise.all([
      Category.find(filter)
        .sort({ level: 1, order: 1, name: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Category.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        categories,
        pagination: formatPagination(total, pageNum, limitNum),
      },
      message: 'Categorías obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/categories/:id
 * ========================================================= */
exports.getCategoryById = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id).populate(
      'parentId',
      'name slug level parentId'
    );
    if (!category) {
      return next(new AppError('Categoría no encontrada', 404));
    }
    res.status(200).json({
      success: true,
      data: category,
      message: 'Categoría obtenida correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/categories/:id/subcategories
 * ========================================================= */
exports.getSubcategories = async (req, res, next) => {
  try {
    const parent = await Category.findById(req.params.id).select('_id');
    if (!parent) {
      return next(new AppError('Categoría no encontrada', 404));
    }

    const subcategories = await Category.find({
      parentId: parent._id,
      isActive: true,
    })
      .sort({ order: 1, name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: { subcategories },
      message: 'Subcategorías obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/categories/:id/breadcrumb
 * ========================================================= */
exports.getCategoryBreadcrumb = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return next(new AppError('Categoría no encontrada', 404));
    }
    const breadcrumb = await category.getBreadcrumb();
    res.status(200).json({
      success: true,
      data: { breadcrumb },
      message: 'Breadcrumb obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/categories/stats  (admin)
 * ========================================================= */
exports.getCategoryStats = async (req, res, next) => {
  try {
    const [
      total,
      active,
      inactive,
      featured,
      globalCount,
      partnerScoped,
      byLevel,
    ] = await Promise.all([
      Category.countDocuments(),
      Category.countDocuments({ isActive: true }),
      Category.countDocuments({ isActive: false }),
      Category.countDocuments({ isFeatured: true, isActive: true }),
      Category.countDocuments({ partnerId: null }),
      Category.countDocuments({ partnerId: { $ne: null } }),
      Category.aggregate([
        { $group: { _id: '$level', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const levelStats = byLevel.reduce((acc, row) => {
      acc[`nivel_${row._id}`] = row.count;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: {
        total,
        active,
        inactive,
        featured,
        global: globalCount,
        partnerScoped,
        byLevel: levelStats,
      },
      message: 'Estadísticas de categorías obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/categories  (admin)
 * ========================================================= */
exports.createCategory = async (req, res, next) => {
  try {
    const {
      name,
      description,
      image,
      icon,
      parentId,
      order,
      isActive,
      isFeatured,
      partnerId,
    } = req.body;

    const duplicate = await Category.findOne({
      name: name.toUpperCase().trim(),
      partnerId: partnerId || null,
    });
    if (duplicate) {
      return next(
        new AppError(
          'Ya existe una categoría con ese nombre para este partner',
          400
        )
      );
    }

    const category = await Category.create({
      name,
      description,
      image,
      icon,
      parentId: parentId || null,
      order: order ?? 0,
      isActive: isActive !== undefined ? isActive : true,
      isFeatured: isFeatured !== undefined ? isFeatured : false,
      partnerId: partnerId || null,
    });

    res.status(201).json({
      success: true,
      data: category,
      message: 'Categoría creada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/categories/:id  (admin)
 * ========================================================= */
exports.updateCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return next(new AppError('Categoría no encontrada', 404));
    }

    const previousLevel = category.level;
    const previousParentId = category.parentId
      ? category.parentId.toString()
      : null;

    if (req.body.name !== undefined) category.name = req.body.name;
    if (req.body.description !== undefined)
      category.description = req.body.description;
    if (req.body.image !== undefined) category.image = req.body.image;
    if (req.body.icon !== undefined) category.icon = req.body.icon;
    if (req.body.order !== undefined) category.order = req.body.order;
    if (req.body.isActive !== undefined) category.isActive = req.body.isActive;
    if (req.body.isFeatured !== undefined)
      category.isFeatured = req.body.isFeatured;
    if (req.body.partnerId !== undefined)
      category.partnerId = req.body.partnerId || null;
    if (req.body.parentId !== undefined) {
      category.parentId = req.body.parentId || null;
    }

    await category.save();

    const newParentId = category.parentId ? category.parentId.toString() : null;
    const parentChanged = previousParentId !== newParentId;

    if (parentChanged || previousLevel !== category.level) {
      await Category.updateDescendantsLevels(category._id, category.level);
    }

    res.status(200).json({
      success: true,
      data: category,
      message: 'Categoría actualizada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  DELETE /api/categories/:id  (admin, soft delete)
 * ========================================================= */
exports.deleteCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return next(new AppError('Categoría no encontrada', 404));
    }
    if (!category.isActive) {
      return next(new AppError('La categoría ya está desactivada', 400));
    }

    const activeChildren = await Category.countDocuments({
      parentId: category._id,
      isActive: true,
    });
    if (activeChildren > 0) {
      return next(
        new AppError(
          'No se puede desactivar una categoría con subcategorías activas. Desactive primero las subcategorías.',
          400
        )
      );
    }

    const hasProducts = await category.hasProducts();
    if (hasProducts) {
      return next(
        new AppError(
          'No se puede desactivar una categoría con productos activos asociados',
          400
        )
      );
    }

    category.isActive = false;
    await category.save();

    res.status(200).json({
      success: true,
      data: category,
      message: 'Categoría desactivada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/categories/:id/status  (admin)
 * ========================================================= */
exports.toggleCategoryStatus = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return next(new AppError('Categoría no encontrada', 404));
    }

    const newStatus =
      req.body.isActive !== undefined ? !!req.body.isActive : !category.isActive;

    if (newStatus === category.isActive) {
      return res.status(200).json({
        success: true,
        data: category,
        message: `La categoría ya estaba ${category.isActive ? 'activa' : 'inactiva'}`,
      });
    }

    if (!newStatus) {
      const activeChildren = await Category.countDocuments({
        parentId: category._id,
        isActive: true,
      });
      if (activeChildren > 0) {
        return next(
          new AppError(
            'No se puede desactivar una categoría con subcategorías activas',
            400
          )
        );
      }
      const hasProducts = await category.hasProducts();
      if (hasProducts) {
        return next(
          new AppError(
            'No se puede desactivar una categoría con productos activos asociados',
            400
          )
        );
      }
    }

    category.isActive = newStatus;
    await category.save();

    res.status(200).json({
      success: true,
      data: category,
      message: `Categoría ${newStatus ? 'activada' : 'desactivada'} correctamente`,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/categories/reorder  (admin)
 * ========================================================= */
exports.reorderCategories = async (req, res, next) => {
  try {
    const { items } = req.body;

    const ids = items.map((i) => i.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      return next(new AppError('Hay IDs duplicados en items', 400));
    }

    const existing = await Category.find({ _id: { $in: ids } }).select('_id');
    if (existing.length !== ids.length) {
      return next(new AppError('Una o más categorías no existen', 404));
    }

    const bulkOps = items.map(({ id, order }) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { order } },
      },
    }));
    await Category.bulkWrite(bulkOps);

    res.status(200).json({
      success: true,
      data: { updated: items.length },
      message: 'Categorías reordenadas correctamente',
    });
  } catch (error) {
    next(error);
  }
};