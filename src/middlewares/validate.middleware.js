const logger = require('../config/logger');

/**
 * Middleware de orden superior para validar req.body, req.query o req.params con Zod
 * @param {import('zod').ZodSchema} schema
 * @param {'body' | 'query' | 'params'} source
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const issues = result.error.issues || result.error.errors || [];
      const formattedErrors = issues.map((err) => ({
        campo: err.path.join('.'),
        mensaje: err.message,
      }));

      logger.warn('Validación de esquema fallida', {
        path: req.originalUrl,
        errors: formattedErrors,
      });

      return res.status(400).json({
        status: 'error',
        message: 'Datos de entrada inválidos',
        detalles: formattedErrors,
      });
    }

    // Sobrescribir con la data parseada y validada
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
