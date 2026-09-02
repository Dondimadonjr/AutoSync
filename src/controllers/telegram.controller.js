const { waitUntil } = require('@vercel/functions');
const logger = require('../config/logger');
const { sendMessage, answerCallbackQuery } = require('../services/telegram.service');
const { procesarAprobacionAsync, procesarRechazo } = require('../services/publisher.service');

/**
 * Endpoint POST /telegram-webhook
 * Manejador principal para Webhooks de Telegram (Serverless Stateless con waitUntil)
 */
async function handleWebhook(req, res) {
  // 1. Responder de inmediato con 200 OK a Telegram para cumplir el SLA (<5s)
  res.status(200).json({ ok: true });

  const update = req.body;
  if (!update) return;

  const tareaWebhook = (async () => {
    try {
      // 2. Manejo de Comandos de Texto (ej: /start)
      if (update.message && update.message.text) {
        const { text, chat, from } = update.message;
        const chatId = chat.id;

        if (text.startsWith('/start')) {
          logger.info('Comando /start recibido', { chatId, user: from?.username });
          await sendMessage(
            chatId,
            `¡Hola, *${from?.first_name || 'Usuario'}*! 👋\n\n` +
              `Bienvenido a *SocialSync AI Engine* 🤖.\n\n` +
              `Tu Chat ID es: \`${chatId}\`\n\n` +
              `Desde aquí recibirás propuestas de contenido para aprobar o rechazar con un solo toque.`
          );
        }
        return;
      }

      // 3. Manejo de Botones Interactivos (Callback Queries)
      if (update.callback_query) {
        const { id: callbackQueryId, message, data } = update.callback_query;
        const chatId = message.chat.id;

        logger.info('Callback query de Telegram recibido', { callbackQueryId, data, chatId });

        // Responder a Telegram para quitar el icono de carga en el botón
        await answerCallbackQuery(callbackQueryId);

        const parts = data.split('_');
        const accion = parts[0];
        const publicacionId = parts.slice(1).join('_'); // Soporta UUIDs

        if (accion === 'aprobar') {
          // Ejecución protegida de publicación en Meta
          await procesarAprobacionAsync(publicacionId, chatId);
        } else if (accion === 'rechazar') {
          await procesarRechazo(publicacionId, chatId);
        } else {
          logger.warn('Acción de callback no reconocida', { accion, data });
        }
      }
    } catch (error) {
      logger.error('Error procesando evento de Telegram Webhook:', {
        error: error.message,
        stack: error.stack,
      });
    }
  })();

  if (typeof waitUntil === 'function') {
    waitUntil(tareaWebhook);
  }
}

module.exports = {
  handleWebhook,
};
