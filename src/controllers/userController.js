const User = require('../models/User');
const AppError = require('../utils/AppError');
const { paginate, formatPagination } = require('../utils/helpers');
const { ROLES } = require('../config/roles');

/* =========================================================
 *  Filtro del listado
 * ========================================================= */
const buildUserFilter = (query) => {
  const filter = {};
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.role) filter.role = query.role;
  if (query.partnerId) filter.partnerId = query.partnerId;
  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { email: { $regex: query.search, $options: 'i' } },
    ];
  }
  return filter;
};

/* =========================================================
 *  Validación de coherencia role ↔ partnerId
 * ========================================================= */
const assertRolePartnerCoherence = (role, partnerId) => {
  const needsPartner = role === ROLES.PARTNER || role === ROLES.EMPLOYEE;
  if (needsPartner && !partnerId) {
    throw new AppError(
      'Los usuarios con rol partner o employee requieren un partnerId',
      400
    );
  }
};

/* =========================================================
 *  GET /api/users
 * ========================================================= */
exports.getUsers = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const { skip, limit: limitNum, page: pageNum } = paginate(page, limit);
    const filter = buildUserFilter(req.query);

    const [users, total] = await Promise.all([
      User.find(filter).sort('-createdAt').skip(skip).limit(limitNum),
      User.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: { users, pagination: formatPagination(total, pageNum, limitNum) },
      message: 'Usuarios obtenidos correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/users/:id
 * ========================================================= */
exports.getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('Usuario no encontrado', 404));
    res.status(200).json({
      success: true,
      data: user,
      message: 'Usuario obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/users
 * ========================================================= */
exports.createUser = async (req, res, next) => {
  try {
    const { name, email, password, phone, image, partnerId } = req.body;
    const role = req.body.role || ROLES.CUSTOMER;

    assertRolePartnerCoherence(role, partnerId);

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return next(new AppError('Ya existe un usuario con ese email', 400));
    }

    const isPartnerScoped =
      role === ROLES.PARTNER || role === ROLES.EMPLOYEE;

    const user = await User.create({
      name,
      email,
      password,
      phone: phone || null,
      image: image || null,
      role,
      partnerId: isPartnerScoped ? partnerId : null,
    });

    res.status(201).json({
      success: true,
      data: user,
      message: 'Usuario creado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/users/:id
 *  Solo edita datos de perfil. Rol y partnerId se cambian
 *  exclusivamente en PATCH /:id/role.
 * ========================================================= */
exports.updateUser = async (req, res, next) => {
  try {
    // Defensa adicional (el validator ya lo bloquea, pero por si acaso)
    if (req.body.role !== undefined || req.body.partnerId !== undefined) {
      return next(
        new AppError(
          "El rol y partnerId no se pueden cambiar por esta ruta.",
          400
        )
      );
    }

    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('Usuario no encontrado', 404));

    if (req.body.name !== undefined) user.name = req.body.name;
    if (req.body.email !== undefined) user.email = req.body.email;
    if (req.body.phone !== undefined) user.phone = req.body.phone;
    if (req.body.image !== undefined) user.image = req.body.image;

    await user.save();

    res.status(200).json({
      success: true,
      data: user,
      message: 'Usuario actualizado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/users/:id/role
 *  Cambia el rol (y opcionalmente el partnerId asociado).
 *  Reglas:
 *   - No permitido cambiarse el rol a sí mismo
 *   - partner/employee requieren partnerId
 *   - admin/customer limpian partnerId
 *   - No se puede degradar al último admin activo
 * ========================================================= */
exports.updateUserRole = async (req, res, next) => {
  try {
    const { role, partnerId } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('Usuario no encontrado', 404));

    // No permitir auto-cambio de rol (evita accidentes y autodemoción)
    if (user._id.equals(req.user._id)) {
      return next(
        new AppError(
          'No puede modificar su propio rol. Solicite a otro administrador.',
          400
        )
      );
    }

    // Normalizar partnerId para comparar idempotencia
    const currentPartnerId = user.partnerId ? user.partnerId.toString() : null;
    const nextPartnerId = partnerId || null;

    // No-op idempotente: si nada cambia, responde 200 sin tocar la DB
    if (user.role === role && currentPartnerId === nextPartnerId) {
      return res.status(200).json({
        success: true,
        data: user,
        message: 'El rol del usuario no ha cambiado',
      });
    }

    // Coherencia role ↔ partnerId
    assertRolePartnerCoherence(role, nextPartnerId);

    // No degradar al último admin activo
    if (user.role === ROLES.ADMIN && user.isActive && role !== ROLES.ADMIN) {
      const activeAdmins = await User.countDocuments({
        role: ROLES.ADMIN,
        isActive: true,
      });
      if (activeAdmins <= 1) {
        return next(
          new AppError(
            'No se puede degradar al último administrador activo',
            400
          )
        );
      }
    }

    // Aplicar cambio
    user.role = role;
    if (role === ROLES.PARTNER || role === ROLES.EMPLOYEE) {
      user.partnerId = nextPartnerId;
    } else {
      user.partnerId = null;
    }
    await user.save();

    res.status(200).json({
      success: true,
      data: user,
      message: `Rol actualizado a '${role}' correctamente`,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  DELETE /api/users/:id  (soft delete)
 * ========================================================= */
exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('Usuario no encontrado', 404));

    if (!user.isActive) {
      return next(new AppError('El usuario ya está desactivado', 400));
    }
    if (user._id.equals(req.user._id)) {
      return next(new AppError('No puede desactivar su propia cuenta', 400));
    }
    if (user.role === ROLES.ADMIN) {
      const activeAdmins = await User.countDocuments({
        role: ROLES.ADMIN,
        isActive: true,
      });
      if (activeAdmins <= 1) {
        return next(
          new AppError(
            'No se puede desactivar al último administrador activo',
            400
          )
        );
      }
    }

    user.isActive = false;
    await user.save();

    res.status(200).json({
      success: true,
      data: user,
      message: 'Usuario desactivado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/users/:id/reactivate
 * ========================================================= */
exports.reactivateUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('Usuario no encontrado', 404));
    if (user.isActive) {
      return next(new AppError('El usuario ya está activo', 400));
    }
    user.isActive = true;
    await user.save();
    res.status(200).json({
      success: true,
      data: user,
      message: 'Usuario reactivado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  DELETE /api/users/:id/permanent
 * ========================================================= */
exports.permanentDeleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('Usuario no encontrado', 404));

    if (user._id.equals(req.user._id)) {
      return next(
        new AppError('No puede eliminarse permanentemente a sí mismo', 400)
      );
    }
    if (user.role === ROLES.ADMIN && user.isActive) {
      const activeAdmins = await User.countDocuments({
        role: ROLES.ADMIN,
        isActive: true,
      });
      if (activeAdmins <= 1) {
        return next(
          new AppError(
            'No se puede eliminar al último administrador activo',
            400
          )
        );
      }
    }

    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      data: null,
      message: 'Usuario eliminado permanentemente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/users/stats
 * ========================================================= */
exports.getUserStats = async (req, res, next) => {
  try {
    const [total, active, inactive, byRole] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ isActive: false }),
      User.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const roleStats = byRole.reduce((acc, r) => {
      acc[r._id] = r.count;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: { total, active, inactive, byRole: roleStats },
      message: 'Estadísticas obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};