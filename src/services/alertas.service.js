const { sendMessage } = require('./telegram.service');
const logger = require('../config/logger');

/**
 * Envía una alerta crítica al administrador por Telegram
 */
async function enviarAlertaCritica(mensajeError, detalles = {}) {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId) {
    logger.warn('No hay TELEGRAM_ADMIN_CHAT_ID configurado para enviar alertas críticas.');
    return;
  }

  const textoAlerta = 
    `🚨 *ALERTA DEL SISTEMA AUTO-SYNC* 🚨\n\n` +
    `❌ *Error:* ${mensajeError}\n` +
    `📦 *Detalles:* \`${JSON.stringify(detalles, null, 2)}\`\n\n` +
    `_Por favor revisa los tokens o el estado del servidor en Vercel._`;

  try {
    await sendMessage(adminChatId, textoAlerta, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Fallo al enviar alerta crítica a Telegram:', error.message);
  }
}

module.exports = {
  enviarAlertaCritica,
};