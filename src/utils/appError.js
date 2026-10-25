/**
 * Clase para errores operacionales (controlados por la aplicación).
 * Los errores no operacionales (bugs, fallos de librerías) se tratan aparte
 * en el errorHandler con un mensaje genérico en producción.
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;