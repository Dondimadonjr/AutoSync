const logger = require('../config/logger');

function obtenerCodigoError(statusCode) {
  switch (statusCode) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    case 502:
      return 'BAD_GATEWAY';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    case 504:
      return 'GATEWAY_TIMEOUT';
    default:
      return 'INTERNAL_ERROR';
  }
}

/**
 * Middleware centralizado de manejo de errores en Express
 */
function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const code = err.code || obtenerCodigoError(statusCode);

  logger.error('Error procesando solicitud HTTP', {
    method: req.method,
    url: req.originalUrl,
    statusCode,
    code,
    message: err.message,
    stack: isProd ? undefined : err.stack,
  });

  res.status(statusCode).json({
    status: 'error',
    code,
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
    code: 'NOT_FOUND',
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
  obtenerCodigoError,
};
