const axios = require('axios');
const env = require('../config/env');
const logger = require('../config/logger');

const TELEGRAM_API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

/**
 * Envía un mensaje de texto a un chat de Telegram
 */
async function sendMessage(chatId, text, options = {}) {
  try {
    const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: options.parse_mode || 'Markdown',
      reply_markup: options.reply_markup,
    });
    return response.data;
  } catch (error) {
    logger.error('Error enviando mensaje por Telegram API', {
      chatId,
      error: error.response?.data || error.message,
    });
    throw new Error(`Fallo al enviar mensaje a Telegram: ${error.response?.data?.description || error.message}`);
  }
}

/**
 * Responde a una Callback Query para detener el spinner en la app de Telegram
 */
async function answerCallbackQuery(callbackQueryId, text = null, showAlert = false) {
  try {
    const response = await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    });
    return response.data;
  } catch (error) {
    logger.warn('Error respondiendo answerCallbackQuery', {
      callbackQueryId,
      error: error.response?.data || error.message,
    });
    // No lanzar excepción aquí para no detener el flujo principal
    return null;
  }
}

/**
 * Envía una propuesta interactiva con botones inline de Aprobación/Rechazo
 */
async function enviarPropuestaInteractivamente(chatId, publicacionId, propuesta, mediaUrl) {
  // Construir caption con HTML para evitar problemas de caracteres especiales
  const hashtagsText = Array.isArray(propuesta.hashtags) 
    ? propuesta.hashtags.join(' ') 
    : propuesta.hashtags;

  const mensaje = 
    `<b>✨ NUEVA PROPUESTA DE CONTENIDO ✨</b>\n\n` +
    `<b>🎬 Idea del Video:</b>\n${propuesta.sugerencia_visual}\n\n` +
    `<b>📝 Caption Sugerido:</b>\n${propuesta.caption}\n\n` +
    `<b>🏷️ Hashtags:</b>\n${hashtagsText}\n\n` +
    `<b>📎 Media:</b> <a href="${mediaUrl}">Ver archivo</a>`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: '✅ Aprobar y Publicar', callback_data: `aprobar_${publicacionId}` },
        { text: '❌ Rechazar', callback_data: `rechazar_${publicacionId}` },
      ],
    ],
  };

  return await sendMessage(chatId, mensaje, {
    parse_mode: 'HTML',
    reply_markup,
  });
}

module.exports = {
  sendMessage,
  answerCallbackQuery,
  enviarPropuestaInteractivamente,
};
