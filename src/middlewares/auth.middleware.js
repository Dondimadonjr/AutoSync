const env = require('../config/env');
const logger = require('../config/logger');

/**
 * Middleware para validar el token secreto enviado por Telegram en sus webhooks.
 * Header: X-Telegram-Bot-Api-Secret-Token
 */
function validateTelegramSecret(req, res, next) {
  const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET;

  // Si no está configurado el secreto en variables de entorno, emitir advertencia
  if (!expectedSecret) {
    logger.warn('TELEGRAM_WEBHOOK_SECRET no configurado. Se permite la petición sin verificar header.');
    return next();
  }

  const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];

  if (!receivedSecret || receivedSecret !== expectedSecret) {
    logger.warn('Acceso denegado: Secret Token de Telegram inválido o ausente', {
      ip: req.ip || req.connection.remoteAddress,
      receivedHeader: receivedSecret ? 'PRESENTE_PERO_NO_COINCIDE' : 'AUSENTE',
    });
    return res.status(403).json({
      status: 'error',
      message: 'Acceso no autorizado al Webhook',
    });
  }

  next();
}

module.exports = {
  validateTelegramSecret,
};
