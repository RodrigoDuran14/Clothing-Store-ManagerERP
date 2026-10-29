const AppError = require('../utils/AppError');
const { ROLES } = require('../config/roles');

/* =========================================================
 *  Genérico: restringe a uno o varios roles
 * ========================================================= */
const restrictTo = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('No autenticado', 401));
  }
  if (!roles.includes(req.user.role)) {
    return next(
      new AppError('No tiene permisos para realizar esta acción', 403)
    );
  }
  next();
};

/* =========================================================
 *  Atajos semánticos
 * ========================================================= */
const isAdmin = restrictTo(ROLES.ADMIN);
const isPartner = restrictTo(ROLES.PARTNER);
const isEmployee = restrictTo(ROLES.EMPLOYEE);

// "Partner o admin": dueño del negocio + admin
const isPartnerOrAdmin = restrictTo(ROLES.PARTNER, ROLES.ADMIN);

// "Empleado o superior": POS, stock, clientes, catálogo lectura
const isEmployeeOrAbove = restrictTo(
  ROLES.EMPLOYEE,
  ROLES.PARTNER,
  ROLES.ADMIN
);

// "Staff": cualquier usuario de back-office (excluye customer)
const isStaff = restrictTo(ROLES.EMPLOYEE, ROLES.PARTNER, ROLES.ADMIN);

/* =========================================================
 *  Mismo usuario o admin
 * ========================================================= */
const isSameUserOrAdmin = (req, res, next) => {
  if (!req.user) return next(new AppError('No autenticado', 401));
  if (req.user.role === ROLES.ADMIN) return next();
  if (req.user._id.toString() === req.params.id) return next();
  return next(
    new AppError('No tiene permisos para realizar esta acción', 403)
  );
};

/* =========================================================
 *  Partner scope: exige que el usuario tenga partnerId
 *  (aplica a partner y employee, no a admin ni customer)
 * ========================================================= */
const requirePartnerScope = (req, res, next) => {
  if (!req.user) return next(new AppError('No autenticado', 401));

  // Admin bypass (puede operar sobre cualquier partner)
  if (req.user.role === ROLES.ADMIN) return next();

  if (req.user.role === ROLES.CUSTOMER) {
    return next(
      new AppError('No tiene permisos para realizar esta acción', 403)
    );
  }

  if (!req.user.partnerId) {
    return next(
      new AppError(
        'El usuario no tiene un partner asignado. Contacte al administrador.',
        403
      )
    );
  }

  next();
};

/**
 * Helper para acotar queries: devuelve un filtro Mongo que fuerza
 * `partnerId` al partner del usuario, salvo para admin.
 *
 * Uso en controllers:
 *   const filter = scopeToPartner(req, baseFilter);
 *   const products = await Product.find(filter);
 */
const scopeToPartner = (req, baseFilter = {}) => {
  if (req.user.role === ROLES.ADMIN) return baseFilter;
  if (!req.user.partnerId) {
    throw new AppError('Usuario sin partner asignado', 403);
  }
  return { ...baseFilter, partnerId: req.user.partnerId };
};

module.exports = {
  restrictTo,
  isAdmin,
  isPartner,
  isEmployee,
  isPartnerOrAdmin,
  isEmployeeOrAbove,
  isStaff,
  isSameUserOrAdmin,
  requirePartnerScope,
  scopeToPartner,
};