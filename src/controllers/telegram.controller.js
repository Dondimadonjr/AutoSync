const { waitUntil } = require('@vercel/functions');
const logger = require('../config/logger');
const { sendMessage, answerCallbackQuery, enviarPropuestaInteractivamente } = require('../services/telegram.service');
const { procesarAprobacionAsync, procesarRechazo } = require('../services/publisher.service');
const { subirVideoDesdeTelegram } = require('../services/storage.service');
const { generarPropuestaPublicacion } = require('../services/ai.service');
const supabase = require('../config/supabase');
const { POST_STATUS } = require('../constants');

// Mapas en memoria para rastrear los estados por usuario (chatId)
const estadosEdicion = new Map();
const estadosProgramacion = new Map();

async function handleWebhook(req, res) {
  res.status(200).json({ ok: true });

  const update = req.body;
  if (!update) return;

  const tareaWebhook = (async () => {
    try {
      if (update.message) {
        const { text, chat, from, video, document, photo, caption } = update.message;
        const chatId = chat.id;

        // 1. Manejo de texto enviado para PROGRAMAR / REPROGRAMAR fecha
        if (text && estadosProgramacion.has(chatId)) {
          const publicacionId = estadosProgramacion.get(chatId);
          estadosProgramacion.delete(chatId);

          // Limpiar texto de entrada del usuario
          const textoLimpio = text.trim();
          
          // Separar Fecha y Hora
          const [fechaPart, horaPart] = textoLimpio.split(' ');

          let fechaProgramada;
          if (fechaPart && horaPart) {
            // Especificar explícitamente el offset de zona horaria local (Chile GMT-4)
            const isoLocalConOffset = `${fechaPart}T${horaPart}:00-04:00`;
            fechaProgramada = new Date(isoLocalConOffset);
          } else {
            fechaProgramada = new Date(textoLimpio);
          }

          if (isNaN(fechaProgramada.getTime())) {
            await sendMessage(
              chatId,
              '❌ *Formato de fecha inválido.* Por favor escribe la fecha con el formato: `AAAA-MM-DD HH:MM` (ejemplo: `2026-09-05 20:50`).'
            );
            return;
          }

          // Convertir a cadena ISO en formato UTC para almacenar en Supabase
          const isoFechaUTC = fechaProgramada.toISOString();

          // Actualizar en Supabase
          const { data: pubActualizada, error: updateError } = await supabase
            .from('publicaciones')
            .update({
              programado_para: isoFechaUTC,
              estado: POST_STATUS.PROGRAMADO || 'PROGRAMADO',
            })
            .eq('id', publicacionId)
            .select('*')
            .single();

          if (updateError) throw updateError;

          // Formatear mensaje de confirmación mostrando la hora en español
          const fechaFormateada = fechaProgramada.toLocaleString('es-CL', {
            timeZone: 'America/Santiago',
            dateStyle: 'medium',
            timeStyle: 'short',
          });

          await sendMessage(
            chatId,
            `📅 *Publicación programada exitosamente para:* *${fechaFormateada}*\n\n` +
            `Si deseas cambiar la fecha o editar el texto antes de publicarse, usa los botones a continuación:`
          );

          await enviarPropuestaInteractivamente(
            chatId,
            pubActualizada.id,
            pubActualizada.caption,
            pubActualizada.media_url
          );
          return;
        }

        // 2. Manejo de texto enviado para EDITAR el caption
        if (text && estadosEdicion.has(chatId)) {
          const publicacionId = estadosEdicion.get(chatId);
          estadosEdicion.delete(chatId);

          const { data: pubActualizada, error: updateError } = await supabase
            .from('publicaciones')
            .update({ caption: text })
            .eq('id', publicacionId)
            .select('*')
            .single();

          if (updateError) throw updateError;

          await sendMessage(chatId, '✅ *Caption actualizado con éxito.* Revisa la nueva versión:');

          await enviarPropuestaInteractivamente(
            chatId,
            pubActualizada.id,
            pubActualizada.caption,
            pubActualizada.media_url
          );
          return;
        }

        // 3. Manejo de subida de Multimedia (Videos / Fotos / Documentos)
        const videoArchivo = video || (document && document.mime_type?.includes('video') ? document : null);
        const fotoArchivo = photo ? photo[photo.length - 1] : null;
        const archivoMultimedia = videoArchivo || fotoArchivo;

        if (archivoMultimedia) {
          logger.info('Archivo multimedia recibido en Telegram', { chatId, fileId: archivoMultimedia.file_id });
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

        // 4. Manejo del comando /start
        if (text && text.startsWith('/start')) {
          await sendMessage(
            chatId,
            `¡Hola, *${from?.first_name || 'Usuario'}*! 👋\n\n` +
              `Bienvenido a *AutoSync* 🤖.\n\n` +
              `Envía cualquier video o foto con una breve leyenda para generar y publicar tu post.`
          );
          return;
        }
      }

      // 5. Manejo de Botones Interactivos (Callback Query)
      if (update.callback_query) {
        const { id: callbackQueryId, message, data } = update.callback_query;
        const chatId = message.chat.id;

        await answerCallbackQuery(callbackQueryId);

        const parts = data.split('_');
        const accion = parts[0];
        const publicacionId = parts.slice(1).join('_');

        if (accion === 'aprobar') {
          await procesarAprobacionAsync(publicacionId, chatId);
        } else if (accion === 'agendar') {
          // Activar flujo de programación / reprogramación
          estadosProgramacion.set(chatId, publicacionId);
          estadosEdicion.delete(chatId);
          await sendMessage(
            chatId,
            `📅 *Modo programación activado.*\n\nEscribe la fecha y hora en la que deseas publicar usando el formato:\n\`AAAA-MM-DD HH:MM\`\n\n*Ejemplo:* \`2026-09-05 20:50\``
          );
        } else if (accion === 'editar') {
          // Activar flujo de edición de caption
          estadosEdicion.set(chatId, publicacionId);
          estadosProgramacion.delete(chatId);
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