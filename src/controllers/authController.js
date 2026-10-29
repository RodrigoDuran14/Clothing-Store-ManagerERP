const User = require('../models/User');
const AppError = require('../utils/AppError');
const { createSendToken } = require('../utils/jwt');
const { filterObj } = require('../utils/helpers');
const { ROLES } = require('../config/roles');

/**
 * POST /api/auth/register
 * Registro público: siempre crea usuario NO admin.
 */
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return next(new AppError('Ya existe un usuario con ese email', 400));
    }

    const user = await User.create({
      name,
      email,
      password,
      phone: phone || null,
       role: ROLES.CUSTOMER, // forzado: registro público nunca escala rol
    });

    createSendToken(user, 201, res, 'Usuario registrado correctamente');
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/login
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(
        new AppError('Por favor proporcione email y contraseña', 400)
      );
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+password'
    );

    if (!user || !(await user.comparePassword(password))) {
      return next(new AppError('Email o contraseña incorrectos', 401));
    }

    if (!user.isActive) {
      return next(
        new AppError(
          'Su cuenta está desactivada. Contacte al administrador.',
          401
        )
      );
    }

    user.lastLogin = Date.now();
    await User.findByIdAndUpdate(user._id, { lastLogin: user.lastLogin });

    createSendToken(user, 200, res, 'Inicio de sesión exitoso');
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/auth/me
 */
exports.getMe = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      data: req.user,
      message: 'Perfil obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/auth/me
 * Actualiza solo name, phone e image.
 */
exports.updateMe = async (req, res, next) => {
  try {
    if (req.body.password) {
      return next(
        new AppError(
          'Esta ruta no es para cambiar la contraseña. Use /update-password',
          400
        )
      );
    }

    const filtered = filterObj(req.body, 'name', 'phone', 'image');
    if (Object.keys(filtered).length === 0) {
      return next(new AppError('No hay campos válidos para actualizar', 400));
    }

    const user = await User.findByIdAndUpdate(req.user._id, filtered, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      data: user,
      message: 'Perfil actualizado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/auth/update-password
 */
exports.updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select('+password');
    if (!user) return next(new AppError('Usuario no encontrado', 404));

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return next(new AppError('La contraseña actual es incorrecta', 401));
    }

    user.password = newPassword;
    await user.save();

    createSendToken(user, 200, res, 'Contraseña actualizada correctamente');
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/logout
 * El cliente elimina el token localmente; aquí solo confirmamos.
 */
exports.logout = (req, res) => {
  res.status(200).json({
    success: true,
    data: null,
    message: 'Sesión cerrada correctamente',
  });
};