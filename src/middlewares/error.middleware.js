const logger = require('../config/logger');

/**
 * Middleware centralizado de manejo de errores en Express
 */
function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';

  logger.error('Error procesando solicitud HTTP', {
    method: req.method,
    url: req.originalUrl,
    statusCode,
    message: err.message,
    stack: isProd ? undefined : err.stack,
  });

  res.status(statusCode).json({
    status: 'error',
    message: err.message || 'Error interno del servidor',
    ...(isProd ? {} : { stack: err.stack }),
  });
}

/**
 * Middleware para rutas no encontradas (404)
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    status: 'error',
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
};
