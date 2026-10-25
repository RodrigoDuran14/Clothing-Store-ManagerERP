const AppError = require('../utils/AppError');

/* ========================================
 *  Traductores de errores específicos a AppError (en español)
 * ========================================*/

// Error de Cast (ObjectId inválido, etc.)
const handleCastErrorDB = (err) => {
  const message = `Recurso no encontrado. Valor inválido para '${err.path}': '${err.value}'`;
  return new AppError(message, 400);
};

// Error de campo duplicado (unique index)
const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];
  const message = `Ya existe un registro con '${field}' = '${value}'. Por favor use otro valor.`;
  return new AppError(message, 400);
};

// Error de validación de Mongoose
const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Datos inválidos: ${errors.join('. ')}`;
  return new AppError(message, 400);
};

// Errores de JWT
const handleJWTError = () =>
  new AppError('Token inválido. Por favor inicie sesión nuevamente.', 401);

const handleJWTExpiredError = () =>
  new AppError('Su sesión ha expirado. Por favor inicie sesión nuevamente.', 401);

/* ========================================
 *  Emisores de respuesta según entorno
 * ===================================== */

const sendErrorDev = (err, res) => {
  res.status(err.statusCode || 500).json({
    success: false,
    data: null,
    message: err.message,
    stack: err.stack,
  });
};

const sendErrorProd = (err, res) => {
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      data: null,
      message: err.message,
    });
  } else {
    // Error no operacional: no filtrar detalles al cliente
    console.error('💥 ERROR NO OPERACIONAL:', err);
    res.status(500).json({
      success: false,
      data: null,
      message: 'Algo salió mal en el servidor',
    });
  }
};

/* ========================================z
 *  Middleware principal
 * ===================================== */

const errorHandler = (err, req, res, next) => {
  let error = err;
  error.statusCode = err.statusCode || 500;
  error.status = err.status || 'error';

  // Normalizar errores conocidos
  if (err.name === 'CastError') error = handleCastErrorDB(err);
  else if (err.code === 11000) error = handleDuplicateFieldsDB(err);
  else if (err.name === 'ValidationError') error = handleValidationErrorDB(err);
  else if (err.name === 'JsonWebTokenError') error = handleJWTError();
  else if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(error, res);
  } else {
    sendErrorProd(error, res);
  }
};

/* ========================================
 *  Middleware 404
 * ===================================== */

const notFound = (req, res, next) => {
  next(new AppError(`Ruta no encontrada: ${req.originalUrl}`, 404));
};

module.exports = { errorHandler, notFound, AppError };