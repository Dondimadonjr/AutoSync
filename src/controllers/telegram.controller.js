const { waitUntil } = require('@vercel/functions');
const logger = require('../config/logger');
const { sendMessage, answerCallbackQuery } = require('../services/telegram.service');
const { procesarAprobacionAsync, procesarRechazo } = require('../services/publisher.service');
const { subirVideoDesdeTelegram } = require('../services/storage.service');
const { generarPostAsync } = require('../services/ai.service'); // O el servicio que genera la propuesta con Gemini

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
      if (update.message) {
        const { text, chat, from, video, document, caption } = update.message;
        const chatId = chat.id;

        // 2. Manejo de Videos/Documentos enviados directamente al chat
        const videoArchivo = video || (document && document.mime_type?.includes('video') ? document : null);

        if (videoArchivo) {
          logger.info('Video recibido en Telegram Webhook', { chatId, fileId: videoArchivo.file_id });

          await sendMessage(chatId, '📥 Video recibido. Subiéndolo a Supabase Storage y generando la propuesta con la IA...');

          // A) Subir a Supabase Storage
          const mediaUrl = await subirVideoDesdeTelegram(videoArchivo.file_id);

          // B) Usar la leyenda del video (caption) como descripción o asignar una por defecto
          const descripcion = caption || 'Publicación generada automáticamente desde Telegram';

          // C) Ejecutar la generación del post e integración con Gemini y Telegram
          await generarPostAsync({
            clienteId: '3da1634c-2f46-47d3-b098-3c1638f27e8c',
            producto: 'Contenido Multimedia',
            descripcion,
            mediaUrl,
            chatId,
          });

          return;
        }

        // 3. Manejo de Comandos de Texto (ej: /start)
        if (text && text.startsWith('/start')) {
          logger.info('Comando /start recibido', { chatId, user: from?.username });
          await sendMessage(
            chatId,
            `¡Hola, *${from?.first_name || 'Usuario'}*! 👋\n\n` +
              `Bienvenido a *SocialSync AI Engine* 🤖.\n\n` +
              `Tu Chat ID es: \`${chatId}\`\n\n` +
              `Desde aquí puedes enviar un video directamente con su descripción para generar y publicar Reels de forma automática.`
          );
          return;
        }
      }

      // 4. Manejo de Botones Interactivos (Callback Queries)
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