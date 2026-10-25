const jwt = require('jsonwebtoken');

/**
 * Firma un token JWT con el payload dado.
 */
const signToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};

/**
 * Verifica y decodifica un token JWT.
 * Lanza error si es inválido o expirado (lo maneja errorHandler).
 */
const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

/**
 * Firma el token, oculta el password del usuario y envía la respuesta.
 * Formato consistente: { success, data: { token, user }, message }.
 */
const createSendToken = (
  user,
  statusCode,
  res,
  message = 'Autenticación exitosa'
) => {
  const token = signToken({ id: user._id, role: user.role });

  // Convertir a objeto plano y remover password
  const userObj = user.toObject ? user.toObject() : { ...user };
  delete userObj.password;

  return res.status(statusCode).json({
    success: true,
    data: { token, user: userObj },
    message,
  });
};

module.exports = { signToken, verifyToken, createSendToken };