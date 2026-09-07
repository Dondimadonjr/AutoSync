const { waitUntil } = require('@vercel/functions');
const logger = require('../config/logger');
const { sendMessage, answerCallbackQuery, enviarPropuestaInteractivamente } = require('../services/telegram.service');
const { procesarAprobacionAsync, procesarRechazo } = require('../services/publisher.service');
const { subirVideoDesdeTelegram } = require('../services/storage.service');
const { generarPropuestaPublicacion } = require('../services/ai.service');
const supabase = require('../config/supabase');
const { POST_STATUS } = require('../constants');

/**
 * Formatea el objeto devuelto por la IA o string a formato texto con hashtags
 */
function formatearCaptionIA(propuesta) {
  if (typeof propuesta === 'object' && propuesta !== null) {
    const hashtags = Array.isArray(propuesta.hashtags) ? propuesta.hashtags.join(' ') : '';
    return `${propuesta.caption}\n\n${hashtags}`.trim();
  }
  return String(propuesta || '').trim();
}

async function handleWebhook(req, res) {
  // Responder inmediatamente 200 a Telegram
  res.status(200).json({ ok: true });

  const update = req.body;
  if (!update) return;

  const tareaWebhook = (async () => {
    try {
      // ---------------------------------------------------------------------
      // A. MENSAJES DE TEXTO Y ARCHIVOS MULTIMEDIA
      // ---------------------------------------------------------------------
      if (update.message) {
        const { text, chat, from, video, document, photo, caption } = update.message;
        const chatId = chat.id;

        // 1. Manejo de entradas de texto libre (esperando FECHA o NUEVO TEXTO)
        if (text && !text.startsWith('/')) {
          
          // A. Si la publicación está esperando FECHA DE PROGRAMACIÓN
          const { data: pubPendienteFecha } = await supabase
            .from('publicaciones')
            .select('*')
            .eq('estado', 'PENDIENTE_FECHA')
            .order('creado_en', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (pubPendienteFecha) {
            const textoLimpio = text.trim();
            const [fechaPart, horaPart] = textoLimpio.split(' ');

            let fechaProgramada;
            if (fechaPart && horaPart) {
              const offsetHorario = '-03:00'; // Ajuste de zona horaria de Chile
              const isoLocalConOffset = `${fechaPart}T${horaPart}:00${offsetHorario}`;
              fechaProgramada = new Date(isoLocalConOffset);
            } else {
              fechaProgramada = new Date(textoLimpio);
            }

            if (isNaN(fechaProgramada.getTime())) {
              await sendMessage(
                chatId,
                '❌ *Formato de fecha inválido.* Por favor escribe la fecha usando el formato: `AAAA-MM-DD HH:MM` (ejemplo: `2026-09-05 21:00`).'
              );
              return;
            }

            const isoFechaUTC = fechaProgramada.toISOString();

            const { data: pubActualizada, error: updateError } = await supabase
              .from('publicaciones')
              .update({
                programado_para: isoFechaUTC,
                estado: POST_STATUS.PROGRAMADO || 'PROGRAMADO',
              })
              .eq('id', pubPendienteFecha.id)
              .select('*')
              .single();

            if (updateError) throw updateError;

            await sendMessage(
              chatId,
              `📅 *Publicación programada exitosamente para:* *${fechaPart} a las ${horaPart}*\n\n` +
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

          // B. Si la publicación está esperando EDICIÓN
          const { data: pubPendienteEditar } = await supabase
            .from('publicaciones')
            .select('*')
            .eq('estado', 'PENDIENTE_EDITAR')
            .order('creado_en', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (pubPendienteEditar) {
            await sendMessage(chatId, '🤖 *Regenerando propuesta con la IA según tus nuevas indicaciones...*');

            try {
              const tipoContenido = 'Publicación para Instagram';
              const propuestaAI = await generarPropuestaPublicacion(tipoContenido, text, 'Instagram');
              const nuevoCaption = formatearCaptionIA(propuestaAI);

              const { data: pubActualizada, error: updateError } = await supabase
                .from('publicaciones')
                .update({ 
                  caption: nuevoCaption,
                  estado: POST_STATUS.PENDIENTE_APROBACION || 'borrador'
                })
                .eq('id', pubPendienteEditar.id)
                .select('*')
                .single();

              if (updateError) throw updateError;

              await sendMessage(chatId, '✅ *Caption regenerado por la IA con éxito.* Revisa la nueva versión:');

              await enviarPropuestaInteractivamente(
                chatId,
                pubActualizada.id,
                pubActualizada.caption,
                pubActualizada.media_url
              );
            } catch (editError) {
              logger.error('Error regenerando propuesta con IA:', { error: editError.message });
              await sendMessage(chatId, `❌ Error al regenerar con la IA: *${editError.message}*`);
            }
            return;
          }
        }

        // 2. Manejo de subida de Multimedia (Archivos individuales y Carruseles/Álbumes)
        const mediaGroupId = update.message.media_group_id;
        const videoArchivo = video || (document && document.mime_type?.includes('video') ? document : null);
        const fotoArchivo = photo ? photo[photo.length - 1] : null;
        const archivoMultimedia = videoArchivo || fotoArchivo;

        if (archivoMultimedia) {
          logger.info('Archivo multimedia recibido en Telegram', { chatId, fileId: archivoMultimedia.file_id, mediaGroupId });

          // A. Si es un ÁLBUM / CARRUSEL (múltiples imágenes/videos juntos)
          if (mediaGroupId) {
            const mediaUrlTemp = await subirVideoDesdeTelegram(archivoMultimedia.file_id);

            // Intentar buscar si ya existe un borrador previo para este media_group_id
            const { data: pubExistente } = await supabase
              .from('publicaciones')
              .select('*')
              .eq('media_group_id', mediaGroupId)
              .maybeSingle();

            if (pubExistente) {
              // Si ya existe la primera foto, anexar esta nueva URL al array media_urls
              const urlsActualizadas = Array.from(
                new Set([...(pubExistente.media_urls || [pubExistente.media_url]), mediaUrlTemp])
              );

              await supabase
                .from('publicaciones')
                .update({ 
                  media_urls: urlsActualizadas,
                  tipo_publicacion: 'CAROUSEL'
                })
                .eq('id', pubExistente.id);

              return; // Salir sin enviar mensajes duplicados
            }

            // Si es la PRIMERA imagen que entra del álbum:
            await sendMessage(chatId, '📥 Álbum de carrusel detectado. Procesando imágenes y generando propuesta con la IA...');

            const tipoContenido = 'Carrusel para Instagram';
            const descripcion = caption || 'Publicación en carrusel con múltiples imágenes/videos';
            const propuesta = await generarPropuestaPublicacion(tipoContenido, descripcion, 'Instagram');
            const captionTexto = formatearCaptionIA(propuesta);

            let clienteId = '3da1634c-2f46-47d3-b098-3c1638f27e8c';
            const { data: clienteDB } = await supabase.from('clientes').select('id').limit(1).single();
            if (clienteDB) clienteId = clienteDB.id;

            // Insertar el borrador base
            const { data: nuevaPub, error: dbErr } = await supabase
              .from('publicaciones')
              .insert({
                cliente_id: clienteId,
                caption: captionTexto,
                media_url: mediaUrlTemp,
                media_urls: [mediaUrlTemp],
                media_group_id: mediaGroupId,
                plataformas: ['instagram'],
                tipo_publicacion: 'CAROUSEL',
                estado: 'borrador',
              })
              .select('id')
              .single();

            if (dbErr) throw dbErr;

            // Pausa estratégica de 3.5s para consolidar todas las fotos enviadas por los webhooks paralelos
            await new Promise((resolve) => setTimeout(resolve, 3500));

            // Obtener el registro actualizado con el array completo de URLs
            const { data: pubFinal } = await supabase
              .from('publicaciones')
              .select('*')
              .eq('id', nuevaPub.id)
              .single();

            // Enviar la propuesta interactiva final con los botones
            await enviarPropuestaInteractivamente(
              chatId, 
              pubFinal.id, 
              pubFinal.caption, 
              pubFinal.media_url
            );
            return;
          }

          // B. Si es un ARCHIVO ÚNICO (Post Normal / Story)
          await sendMessage(chatId, '📥 Archivo recibido. Subiéndolo a Supabase Storage y generando propuesta...');

          const mediaUrl = await subirVideoDesdeTelegram(archivoMultimedia.file_id);
          const tipoContenido = fotoArchivo ? 'Imagen para Instagram' : 'Reel de Instagram';
          const descripcion = caption || 'Publicación visual atractiva para redes sociales';

          const propuesta = await generarPropuestaPublicacion(tipoContenido, descripcion, 'Instagram');
          const captionTexto = formatearCaptionIA(propuesta);

          let clienteId = '3da1634c-2f46-47d3-b098-3c1638f27e8c';
          const { data: clienteDB } = await supabase.from('clientes').select('id').limit(1).single();
          if (clienteDB) clienteId = clienteDB.id;

          const { data: nuevaPublicacion, error: dbError } = await supabase
            .from('publicaciones')
            .insert({
              cliente_id: clienteId,
              caption: captionTexto,
              media_url: mediaUrl,
              media_urls: [mediaUrl],
              plataformas: ['instagram'],
              tipo_publicacion: 'FEED',
              estado: 'borrador',
            })
            .select('id')
            .single();

          if (dbError) throw dbError;

          await enviarPropuestaInteractivamente(chatId, nuevaPublicacion.id, propuesta, mediaUrl);
          return;
        }

        // 3. Comando /start
        if (text && text.startsWith('/start')) {
          await sendMessage(
            chatId,
            `¡Hola, *${from?.first_name || 'Usuario'}*! 👋\n\n` +
              `Bienvenido a *AutoSync* 🤖.\n\n` +
              `Envía cualquier video o foto con una breve leyenda para generar y publicar tu post.`
          );
          return;
        }
      } // Fin de if (update.message)

      // ---------------------------------------------------------------------
      // B. BOTONES INTERACTIVOS (CALLBACK QUERY)
      // ---------------------------------------------------------------------
      if (update.callback_query) {
        const { id: callbackQueryId, message, data } = update.callback_query;
        const chatId = message.chat.id;

        await answerCallbackQuery(callbackQueryId);

        const parts = data.split('_');
        const accion = parts[0];

        if (accion === 'tipo') {
          const tipoSeleccionado = parts[1]; // 'FEED' o 'STORY'
          const realPublicacionId = parts.slice(2).join('_');

          // Consultar si es una publicación con múltiples imágenes
          const { data: pubActual } = await supabase
            .from('publicaciones')
            .select('media_urls')
            .eq('id', realPublicacionId)
            .single();

          const esCarrusel = pubActual?.media_urls && pubActual.media_urls.length > 1;
          const tipoFinal = (tipoSeleccionado === 'FEED' && esCarrusel) ? 'CAROUSEL' : tipoSeleccionado;

          const { error: updateTypeError } = await supabase
            .from('publicaciones')
            .update({ tipo_publicacion: tipoFinal })
            .eq('id', realPublicacionId);

          if (updateTypeError) {
            logger.error('Error al actualizar tipo_publicacion:', updateTypeError);
            await sendMessage(chatId, '❌ No se pudo cambiar el formato de publicación.');
            return;
          }

          let mensajeTipo = '📸 Post Normal (Feed)';
          if (tipoFinal === 'STORY') mensajeTipo = '📱 Historia / Story';
          if (tipoFinal === 'CAROUSEL') mensajeTipo = '🎠 Carrusel (Múltiples fotos)';

          await sendMessage(chatId, `✅ Formato actualizado a: *${mensajeTipo}*`);

        } else {
          const publicacionId = parts.slice(1).join('_');

          if (accion === 'aprobar') {
            await procesarAprobacionAsync(publicacionId, chatId);
          } else if (accion === 'agendar') {
            await supabase
              .from('publicaciones')
              .update({ estado: 'PENDIENTE_FECHA' })
              .eq('id', publicacionId);

            await sendMessage(
              chatId,
              `📅 *Modo programación activado.*\n\nEscribe la fecha y hora en la que deseas publicar usando el formato:\n\`AAAA-MM-DD HH:MM\`\n\n*Ejemplo:* \`2026-09-05 21:15\``
            );
          } else if (accion === 'editar') {
            await supabase
              .from('publicaciones')
              .update({ estado: 'PENDIENTE_EDITAR' })
              .eq('id', publicacionId);

            await sendMessage(
              chatId,
              `✏️ *Modo edición con IA activado.*\n\nEscribe los nuevos detalles o instrucciones (ejemplo: *"plato de agua, 130 diametro x 50 alto, ideal para exteriores"*) para regenerar el post:`
            );
          } else if (accion === 'rechazar') {
            await procesarRechazo(publicacionId, chatId);
          }
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