const { waitUntil } = require('@vercel/functions');
const logger = require('../config/logger');
const { sendMessage, answerCallbackQuery, enviarPropuestaInteractivamente } = require('../services/telegram.service');
const { procesarAprobacionAsync, procesarRechazo } = require('../services/publisher.service');
const { subirVideoDesdeTelegram } = require('../services/storage.service');
const { generarPropuestaPublicacion } = require('../services/ai.service');
const supabase = require('../config/supabase');
const { POST_STATUS } = require('../constants');

async function handleWebhook(req, res) {
  res.status(200).json({ ok: true });

  const update = req.body;
  if (!update) return;

  const tareaWebhook = (async () => {
    try {
      if (update.message) {
        const { text, chat, from, video, document, caption } = update.message;
        const chatId = chat.id;

        if (update.message) {
          const { text, chat, from, video, document, photo, caption } = update.message;
          const chatId = chat.id;

          // 1. Detectar Video, Documento o Foto (Telegram envía photo como un arreglo de tamaños)
          const videoArchivo = video || (document && document.mime_type?.includes('video') ? document : null);
          const fotoArchivo = photo ? photo[photo.length - 1] : null; // Toma la foto de mayor resolución

          const archivoMultimedia = videoArchivo || fotoArchivo;

          if (archivoMultimedia) {
            logger.info('Archivo multimedia recibido en Telegram', { chatId, fileId: archivoMultimedia.file_id });

            await sendMessage(chatId, '📥 Archivo recibido. Subiéndolo a Supabase Storage y generando la propuesta con la IA...');

            try {
              // 2. Subir imagen o video a Supabase Storage
              const mediaUrl = await subirVideoDesdeTelegram(archivoMultimedia.file_id);

              // 3. Adaptar el prompt de la IA según el tipo de contenido
              const tipoContenido = fotoArchivo ? 'Imagen para Instagram' : 'Reel de Instagram';
              const descripcion = caption || 'Publicación visual llamativa para redes sociales';

              const propuesta = await generarPropuestaPublicacion(tipoContenido, descripcion, 'Instagram');

              const captionTexto = typeof propuesta === 'object' 
                ? `${propuesta.caption}\n\n${Array.isArray(propuesta.hashtags) ? propuesta.hashtags.join(' ') : ''}`
                : propuesta;

              // 4. Buscar cliente
              let clienteId = '3da1634c-2f46-47d3-b098-3c1638f27e8c';
              const { data: clienteDB } = await supabase.from('clientes').select('id').limit(1).single();
              if (clienteDB) clienteId = clienteDB.id;

              // 5. Guardar en Supabase
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

              // 6. Enviar respuesta interactiva
              await enviarPropuestaInteractivamente(chatId, nuevaPublicacion.id, propuesta, mediaUrl);

            } catch (subError) {
              logger.error('Error procesando multimedia:', { error: subError.message });
              await sendMessage(chatId, `❌ Error durante el procesamiento: *${subError.message}*`);
            }
            return;
          }
        }

        // A) Manejo de Videos/Documentos enviados al chat
        const videoArchivo = video || (document && document.mime_type?.includes('video') ? document : null);

        if (videoArchivo) {
          logger.info('Video recibido en Telegram Webhook', { chatId, fileId: videoArchivo.file_id });

          await sendMessage(chatId, '📥 Video recibido. Subiéndolo a Supabase Storage y generando la propuesta con la IA...');

          try {
            // 1. Subir a Supabase Storage
            const mediaUrl = await subirVideoDesdeTelegram(videoArchivo.file_id);

            // 2. Generar la propuesta con Gemini (PRIMERO)
            // 2. Usar el texto introducido en Telegram o un texto general si viene vacío
              const descripcionVideo = caption || 'Video corto con momentos destacados y contenido atractivo para redes sociales';

              // 3. Generar la propuesta pasando el texto dinámico
              const propuesta = await generarPropuestaPublicacion(
                'Reel de Instagram', // Nombre del tipo de contenido
                descripcionVideo,    // Texto enviado como leyenda en Telegram
                'Instagram Reels'    // Red social de destino
              );

            // 3. Formatear el captionTexto DESPUÉS de obtener la propuesta
            const captionTexto = typeof propuesta === 'object' 
              ? `${propuesta.caption}\n\n${Array.isArray(propuesta.hashtags) ? propuesta.hashtags.join(' ') : ''}`
              : propuesta;

            // 4. Buscar el primer cliente disponible en Supabase si el ID fijo no existe
            let clienteId = '3da1634c-2f46-47d3-b098-3c1638f27e8c';
            const { data: clienteDB } = await supabase.from('clientes').select('id').limit(1).single();
            if (clienteDB) {
              clienteId = clienteDB.id;
            }

            // 5. Guardar publicación en Supabase en la columna 'caption'
            const { data: nuevaPublicacion, error: dbError } = await supabase
              .from('publicaciones')
              .insert({
                cliente_id: clienteId,
                caption: captionTexto,
                media_url: mediaUrl,
                plataformas: ['instagram'], // <-- AGREGAR ESTA LÍNEA (tipo ARRAY de texto)
                estado: POST_STATUS.PENDIENTE_APROBACION,
              })
              .select('id')
              .single();

            if (dbError) throw dbError;

            // 6. Enviar propuesta interactiva con botones a Telegram
            await enviarPropuestaInteractivamente(chatId, nuevaPublicacion.id, propuesta, mediaUrl);

          } catch (subError) {
            logger.error('Error detallado procesando el video:', { error: subError.message, stack: subError.stack });
            await sendMessage(chatId, `❌ Error durante el procesamiento: *${subError.message}*`);
          }
          return;
        }

        // B) Manejo de /start
        if (text && text.startsWith('/start')) {
          await sendMessage(
            chatId,
            `¡Hola, *${from?.first_name || 'Usuario'}*! 👋\n\n` +
              `Bienvenido a *SocialSync AI Engine* 🤖.\n\n` +
              `Envía cualquier video o imagen con una breve descripción para generar y publicar tu Reel/publicación en Redes Sociales.`
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
      logger.error('Error general en Telegram Webhook:', { error: error.message, stack: error.stack });
    }
  })();

  if (typeof waitUntil === 'function') {
    waitUntil(tareaWebhook);
  }
}

module.exports = { handleWebhook };