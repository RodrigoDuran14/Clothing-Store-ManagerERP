const User = require('../models/User');
const AppError = require('../utils/AppError');
const { verifyToken } = require('../utils/jwt');

/**
 * Verifica el JWT, carga el usuario, valida activo + passwordChangedAt.
 * Deja el usuario completo en `req.user`.
 */
const protect = async (req, res, next) => {
  try {
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer ')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(
        new AppError('No está autenticado. Por favor inicie sesión.', 401)
      );
    }

    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id);

    if (!user) {
      return next(
        new AppError('El usuario asociado a este token ya no existe.', 401)
      );
    }
    if (!user.isActive) {
      return next(new AppError('Su cuenta ha sido desactivada.', 401));
    }
    if (user.changedPasswordAfter(decoded.iat)) {
      return next(
        new AppError(
          'La contraseña fue cambiada recientemente. Inicie sesión nuevamente.',
          401
        )
      );
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Autenticación opcional: si hay token válido, carga req.user.
 * Si no hay token o es inválido, continúa como invitado (no bloquea).
 * Útil para endpoints públicos que muestran más datos a staff autenticado.
 */
const softProtect = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return next();

    const token = header.split(' ')[1];
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id);

    if (user && user.isActive && !user.changedPasswordAfter(decoded.iat)) {
      req.user = user;
    }
  } catch {
    // Ignorar: invitado
  }
  next();
};

module.exports = { protect, softProtect };