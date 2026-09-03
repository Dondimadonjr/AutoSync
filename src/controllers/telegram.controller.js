const { waitUntil } = require('@vercel/functions');
const logger = require('../config/logger');
const { sendMessage, answerCallbackQuery, enviarPropuestaInteractivamente } = require('../services/telegram.service');
const { procesarAprobacionAsync, procesarRechazo } = require('../services/publisher.service');
const { subirVideoDesdeTelegram } = require('../services/storage.service');
const { generarPropuestaPublicacion } = require('../services/ai.service');
const supabase = require('../config/supabase');
const { POST_STATUS } = require('../constants');
const estadosEdicion = new Map();

async function handleWebhook(req, res) {
  res.status(200).json({ ok: true });

  const update = req.body;
  if (!update) return;

  const tareaWebhook = (async () => {
    try {
      if (update.message) {
        const { text, chat, from, video, document, photo, caption } = update.message;
        const chatId = chat.id;

        // 1. Si el usuario está respondiendo para EDITAR un caption
        if (text && estadosEdicion.has(chatId)) {
          const publicacionId = estadosEdicion.get(chatId);
          estadosEdicion.delete(chatId); // Limpiar estado

          // Actualizar caption en Supabase
          const { data: pubActualizada, error: updateError } = await supabase
            .from('publicaciones')
            .update({ caption: text })
            .eq('id', publicacionId)
            .select('*')
            .single();

          if (updateError) throw updateError;

          await sendMessage(chatId, '✅ *Caption actualizado con éxito.* Revisa la nueva versión:');
          
          // Reenviar propuesta con los nuevos botones
          await enviarPropuestaInteractivamente(chatId, pubActualizada.id, pubActualizada.caption, pubActualizada.media_url);
          return;
        }

        // 2. Manejo de Videos/Fotos/Documentos
        const videoArchivo = video || (document && document.mime_type?.includes('video') ? document : null);
        const fotoArchivo = photo ? photo[photo.length - 1] : null;
        const archivoMultimedia = videoArchivo || fotoArchivo;

        if (archivoMultimedia) {
          logger.info('Archivo recibido en Telegram', { chatId, fileId: archivoMultimedia.file_id });
          await sendMessage(chatId, '📥 Archivo recibido. Subiéndolo a Supabase Storage y generando la propuesta con la IA...');

          try {
            const mediaUrl = await subirVideoDesdeTelegram(archivoMultimedia.file_id);
            const tipoContenido = fotoArchivo ? 'Imagen para Instagram' : 'Reel de Instagram';
            const descripcion = caption || 'Publicación visual atractiva para redes sociales';

            const propuesta = await generarPropuestaPublicacion(tipoContenido, descripcion, 'Instagram');
            const captionTexto = typeof propuesta === 'object'
              ? `${propuesta.caption}\n\n${Array.isArray(propuesta.hashtags) ? propuesta.hashtags.join(' ') : ''}`
              : propuesta;

            let clienteId = '3da1634c-2f46-47d3-b098-3c1638f27e8c';
            const { data: clienteDB } = await supabase.from('clientes').select('id').limit(1).single();
            if (clienteDB) clienteId = clienteDB.id;

            const { data: nuevaPublicacion, error: dbError } = await supabase
              .from('publicaciones')
              .insert({
                cliente_id: clienteId,
                caption: captionTexto,
                media_url: mediaUrl,
                plataformas: ['instagram'],
                estado: POST_STATUS.PENDIENTE_APROBACION,
              })
              .select('id')
              .single();

            if (dbError) throw dbError;

            await enviarPropuestaInteractivamente(chatId, nuevaPublicacion.id, propuesta, mediaUrl);

          } catch (subError) {
            logger.error('Error procesando multimedia:', { error: subError.message });
            await sendMessage(chatId, `❌ Error durante el procesamiento: *${subError.message}*`);
          }
          return;
        }

        // 3. Manejo de /start
        if (text && text.startsWith('/start')) {
          await sendMessage(
            chatId,
            `¡Hola, *${from?.first_name || 'Usuario'}*! 👋\n\n` +
              `Bienvenido a *SocialSync AI Engine* 🤖.\n\n` +
              `Envía cualquier video o foto con una breve leyenda para generar y publicar tu post.`
          );
          return;
        }
      }

      // 4. Manejo de Botones
      if (update.callback_query) {
        const { id: callbackQueryId, message, data } = update.callback_query;
        const chatId = message.chat.id;

        await answerCallbackQuery(callbackQueryId);

        const parts = data.split('_');
        const accion = parts[0];
        const publicacionId = parts.slice(1).join('_');

        if (accion === 'aprobar') {
          await procesarAprobacionAsync(publicacionId, chatId);
        } else if (accion === 'editar') {
          // Guardar estado de edición
          estadosEdicion.set(chatId, publicacionId);
          await sendMessage(
            chatId,
            `✏️ *Modo edición activado.*\n\nEscribe y envía el nuevo texto/caption que deseas colocar en esta publicación:`
          );
        } else if (accion === 'rechazar') {
          await procesarRechazo(publicacionId, chatId);
        }
      }
    } catch (error) {
      logger.error('Error general en Telegram Webhook:', { error: error.message, stack: error.stack });
    }
  })();

  if (typeof waitUntil === 'function') {
    waitUntil(tareaWebhook);
  }
}

module.exports = { handleWebhook };