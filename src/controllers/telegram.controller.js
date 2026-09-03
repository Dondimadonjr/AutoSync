const { waitUntil } = require('@vercel/functions');
const logger = require('../config/logger');
const { sendMessage, answerCallbackQuery, enviarPropuestaInteractivamente } = require('../services/telegram.service');
const { procesarAprobacionAsync, procesarRechazo } = require('../services/publisher.service');
const { subirVideoDesdeTelegram } = require('../services/storage.service'); // Asegúrate que el archivo se llame storage.service.js
const { generarPropuestaPublicacion } = require('../services/ai.service');
const supabase = require('../config/supabase');
const { POST_STATUS } = require('../constants');

/**
 * Endpoint POST /telegram-webhook
 */
async function handleWebhook(req, res) {
  res.status(200).json({ ok: true });

  const update = req.body;
  if (!update) return;

  const tareaWebhook = (async () => {
    try {
      if (update.message) {
        const { text, chat, from, video, document, caption } = update.message;
        const chatId = chat.id;

        // A) Manejo de Videos/Documentos enviados al chat
        const videoArchivo = video || (document && document.mime_type?.includes('video') ? document : null);

        if (videoArchivo) {
          logger.info('Video recibido en Telegram Webhook', { chatId, fileId: videoArchivo.file_id });

          await sendMessage(chatId, '📥 Video recibido. Subiéndolo a Supabase Storage y generando la propuesta con la IA...');

          // 1. Subir a Supabase Storage
          const mediaUrl = await subirVideoDesdeTelegram(videoArchivo.file_id);

          // 2. Definir parámetros
          const clienteId = '3da1634c-2f46-47d3-b098-3c1638f27e8c';
          const producto = 'Contenido Telegram';
          const descripcion = caption || 'Publicación generada automáticamente desde Telegram';

          // 3. Generar la propuesta con Gemini
          const propuesta = await generarPropuestaPublicacion({ producto, descripcion });

          // 4. Guardar en Supabase
          const { data: nuevaPublicacion, error: dbError } = await supabase
            .from('publicaciones')
            .insert({
              cliente_id: clienteId,
              contenido: propuesta,
              media_url: mediaUrl,
              estado: POST_STATUS.PENDIENTE_APROBACION,
            })
            .select('id')
            .single();

          if (dbError) throw dbError;

          // 5. Enviar propuesta a Telegram con botones interactivos
          await enviarPropuestaInteractivamente(chatId, nuevaPublicacion.id, propuesta, mediaUrl);
          return;
        }

        // B) Manejo de /start
        if (text && text.startsWith('/start')) {
          await sendMessage(
            chatId,
            `¡Hola, *${from?.first_name || 'Usuario'}*! 👋\n\n` +
              `Bienvenido a *SocialSync AI Engine* 🤖.\n\n` +
              `Envía cualquier video con una breve descripción en la leyenda para generar y publicar tu Reel en Instagram.`
          );
          return;
        }
      }

      // C) Manejo de Botones
      if (update.callback_query) {
        const { id: callbackQueryId, message, data } = update.callback_query;
        const chatId = message.chat.id;

        await answerCallbackQuery(callbackQueryId);

        const parts = data.split('_');
        const accion = parts[0];
        const publicacionId = parts.slice(1).join('_');

        if (accion === 'aprobar') {
          await procesarAprobacionAsync(publicacionId, chatId);
        } else if (accion === 'rechazar') {
          await procesarRechazo(publicacionId, chatId);
        }
      }
    } catch (error) {
      logger.error('Error en Telegram Webhook:', { error: error.message, stack: error.stack });
    }
  })();

  if (typeof waitUntil === 'function') {
    waitUntil(tareaWebhook);
  }
}

module.exports = { handleWebhook };