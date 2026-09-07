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
 * Envía la lista de publicaciones programadas con botones para gestionar cada una
 */
/**
 * Envía la lista de publicaciones programadas con botones para gestionar cada una
 */
async function listarPublicacionesAgendadas(chatId, publicaciones) {
  if (!publicaciones || publicaciones.length === 0) {
    return sendMessage(chatId, '📅 *No tienes publicaciones programadas por el momento.*');
  }

  let texto = '📅 *PUBLICACIONES PROGRAMADAS*\n\n';

  publicaciones.forEach((pub, index) => {
    const fecha = new Date(pub.programado_para).toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    const previewCaption = pub.caption ? pub.caption.substring(0, 60) + '...' : 'Sin texto';
    
    texto += `*${index + 1}. [${pub.tipo_publicacion}]* - ${fecha}\n`;
    texto += `📝 _${previewCaption}_\n\n`;
  });

  const inlineKeyboard = publicaciones.map((pub, index) => [
    { text: `❌ Cancelar #${index + 1}`, callback_data: `cancelaragendado_${pub.id}` }
  ]);

  return sendInlineKeyboard(chatId, texto, inlineKeyboard);
}



/**
 * Envía una propuesta interactiva con botones inline de Aprobación/Rechazo
 */
async function enviarPropuestaInteractivamente(chatId, publicacionId, propuesta, mediaUrl) {
  const captionTexto = typeof propuesta === 'object'
    ? `${propuesta.caption}\n\n${Array.isArray(propuesta.hashtags) ? propuesta.hashtags.join(' ') : ''}`
    : propuesta;

  const mensaje = `✨ *NUEVA PROPUESTA DE CONTENIDO* ✨\n\n` +
    `📝 *Caption Sugerido:*\n${captionTexto}\n\n` +
    `📎 *Media:* [Ver archivo](${mediaUrl})`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📸 Post Normal', callback_data: `tipo_FEED_${publicacionId}` },
        { text: '📱 Historia / Story', callback_data: `tipo_STORY_${publicacionId}` },
      ],
      [
        { text: '🚀 Publicar Ahora', callback_data: `aprobar_${publicacionId}` },
        { text: '📅 Programar', callback_data: `agendar_${publicacionId}` },
      ],
      [
        { text: '✏️ Editar Caption', callback_data: `editar_${publicacionId}` },
        { text: '❌ Rechazar', callback_data: `rechazar_${publicacionId}` },
      ],
    ],
  };

  await sendMessage(chatId, mensaje, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

module.exports = {
  sendMessage,
  answerCallbackQuery,
  enviarPropuestaInteractivamente,
  sendInlineKeyboard,
  listarPublicacionesAgendadas, 
};
