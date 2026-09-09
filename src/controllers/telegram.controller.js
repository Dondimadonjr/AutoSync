const { waitUntil } = require('@vercel/functions');
const logger = require('../config/logger');
const { 
  sendMessage, 
  answerCallbackQuery, 
  enviarPropuestaInteractivamente, 
} = require('../services/telegram.service');
const { procesarAprobacionAsync, procesarRechazo, registrarLog } = require('../services/publisher.service');
const { subirVideoDesdeTelegram, descargarArchivoTelegram, subirBufferASupabase } = require('../services/storage.service');
const { generarPropuestaPublicacion, generarPropuestaConImagen } = require('../services/ai.service');
const supabase = require('../config/supabase');
const { POST_STATUS } = require('../constants');
const { listarAgendados } = require('./agendados.controller');

/**
 * Formatea la propuesta devuelta por la IA a texto plano con hashtags
 */
function formatearCaptionIA(propuesta) {
  if (typeof propuesta === 'object' && propuesta !== null) {
    const hashtags = Array.isArray(propuesta.hashtags) ? propuesta.hashtags.join(' ') : '';
    return `${propuesta.caption}\n\n${hashtags}`.trim();
  }
  return String(propuesta || '').trim();
}

async function handleWebhook(req, res) {
  // Responder HTTP 200 de inmediato a Telegram
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

        // 1. Comando /start
        if (text && text.startsWith('/start')) {
          await sendMessage(
            chatId,
            `¡Hola, *${from?.first_name || 'Usuario'}*! 👋\n\n` +
              `Bienvenido a *AutoSync* 🤖.\n\n` +
              `Envía cualquier video o foto con una breve leyenda para generar y publicar tu post.`
          );
          return;
        }

        // 2. Comando /agendados
        if (text && text.startsWith('/agendados')) {
          await listarAgendados(chatId);
          return;
        }

        // 3. Entradas de Texto Libre (esperando FECHA o EDICIÓN)
        if (text && !text.startsWith('/')) {
          
          // Estado: PENDIENTE_FECHA
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
              const offsetHorario = '-03:00'; // Ajuste horario de Chile
              const isoLocalConOffset = `${fechaPart}T${horaPart}:00${offsetHorario}`;
              fechaProgramada = new Date(isoLocalConOffset);
            } else {
              fechaProgramada = new Date(textoLimpio);
            }

            const ahora = new Date();

            // 1. Validar formato de fecha
            if (isNaN(fechaProgramada.getTime())) {
              await sendMessage(
                chatId,
                '❌ *Formato de fecha inválido.* Por favor escribe la fecha usando el formato: `AAAA-MM-DD HH:MM` (ejemplo: `2026-09-10 18:30`).'
              );
              return;
            }

            // 2. Validar que la fecha no sea en el pasado
            if (fechaProgramada <= ahora) {
              await sendMessage(
                chatId,
                '⚠️ *La fecha ingresada ya pasó.* Por favor ingresa una fecha y hora futura (ejemplo: `2026-09-10 18:30`).'
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

            // 3. Respuesta unificada con confirmación, texto y botones interactivos
            const encabezadoConfirmacion = `📅 *PUBLICACIÓN PROGRAMADA*\n📌 *Fecha:* ${fechaPart} a las ${horaPart}`;

            await enviarPropuestaInteractivamente(
              chatId,
              pubActualizada.id,
              pubActualizada.caption || 'Sin caption',
              pubActualizada.media_url,
              encabezadoConfirmacion
            );
            return;
          }

          // Estado: PENDIENTE_EDITAR
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
              // Recuperar la imagen original para re-analizarla junto con la corrección del usuario
              let propuestaAI;
              if (pubPendienteEditar.media_url && !pubPendienteEditar.media_url.toLowerCase().includes('.mp4')) {
                const axios = require('axios');
                const imgRes = await axios.get(pubPendienteEditar.media_url, { responseType: 'arraybuffer' });
                const imgBuffer = Buffer.from(imgRes.data, 'binary');
                const mimeType = pubPendienteEditar.media_url.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';
                propuestaAI = await generarPropuestaConImagen(imgBuffer, mimeType, text);
              } else {
                // Fallback para videos o si no hay imagen: usar prompt de texto
                propuestaAI = await generarPropuestaPublicacion('Publicación para Redes Sociales', text, 'Instagram');
              }
              const nuevoCaption = formatearCaptionIA(propuestaAI);

              const { data: pubActualizada, error: updateError } = await supabase
                .from('publicaciones')
                .update({ 
                  caption: nuevoCaption,
                  tokens_usados: propuestaAI?.tokens || 0,
                  estado: POST_STATUS.PENDIENTE_APROBACION || 'borrador'
                })
                .eq('id', pubPendienteEditar.id)
                .select('*')
                .single();

              if (updateError) throw updateError;

              await registrarLog(pubActualizada.id, 'PROPUESTA_REGENERADA', 'INFO', {
                tokens: propuestaAI?.tokens,
                usage: propuestaAI?.usage,
              });

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

        // 4. Subida de Multimedia
        const mediaGroupId = update.message.media_group_id;
        const videoArchivo = video || (document && document.mime_type?.includes('video') ? document : null);
        const fotoArchivo = photo ? photo[photo.length - 1] : null;
        const archivoMultimedia = videoArchivo || fotoArchivo;

        if (archivoMultimedia) {
          logger.info('Archivo multimedia recibido en Telegram', { chatId, fileId: archivoMultimedia.file_id, mediaGroupId });

          // A. ÁLBUM / CARRUSEL (Invocación atómica a Postgres)
          if (mediaGroupId) {
            const mediaUrlTemp = await subirVideoDesdeTelegram(archivoMultimedia.file_id);

            let clienteId = '3da1634c-2f46-47d3-b098-3c1638f27e8c';
            const { data: clienteDB } = await supabase.from('clientes').select('id').limit(1).single();
            if (clienteDB) clienteId = clienteDB.id;

            // Invocar el procedimiento atómico
            const { data: rpcRows, error: rpcError } = await supabase
              .rpc('upsert_carousel_publicacion', {
                p_media_group_id: mediaGroupId,
                p_media_url: mediaUrlTemp,
                p_cliente_id: clienteId,
              });

            if (rpcError) throw rpcError;

            const resultadoUpsert = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

            if (!resultadoUpsert.was_inserted) {
              // Si fue una actualización (segunda foto en adelante), salir en silencio
              return;
            }

            // Si fue la inserción inicial (primera foto), notificar y llamar a la IA
            await sendMessage(chatId, '📥 Álbum de carrusel detectado. Procesando imágenes y generando propuesta con la IA...');

            const tipoContenido = 'Carrusel para Redes Sociales';
            const descripcion = caption || 'Publicación en carrusel con múltiples imágenes/videos';
            const propuesta = await generarPropuestaPublicacion(tipoContenido, descripcion, 'Instagram');
            const captionTexto = formatearCaptionIA(propuesta);

            const { error: captionUpdateError } = await supabase
              .from('publicaciones')
              .update({ 
                caption: captionTexto,
                tokens_usados: propuesta?.tokens || 0,
                plataformas: ['instagram', 'facebook', 'threads', 'tiktok'] // Activados por defecto
              })
              .eq('id', resultadoUpsert.id);

            if (captionUpdateError) throw captionUpdateError;

            await registrarLog(resultadoUpsert.id, 'CARRUSEL_PROPUESTA_GENERADA', 'INFO', {
              tokens: propuesta?.tokens,
              usage: propuesta?.usage,
            });

            // Pausa estratégica para esperar la subida paralela de los demás archivos del álbum
            await new Promise((resolve) => setTimeout(resolve, 4500));

            // Leer estado final con todas las URLs agregadas por el RPC
            const { data: pubFinal } = await supabase
              .from('publicaciones')
              .select('*')
              .eq('id', resultadoUpsert.id)
              .single();

            const urlsConsolidadas = Array.isArray(pubFinal.media_urls) && pubFinal.media_urls.length > 0
              ? pubFinal.media_urls
              : [pubFinal.media_url];

            await enviarPropuestaInteractivamente(
              chatId,
              pubFinal.id,
              pubFinal.caption,
              urlsConsolidadas[0]
            );
            return;
          }

          // B. ARCHIVO ÚNICO (Post Normal / Story / Reel)
          await sendMessage(chatId, '📥 Archivo recibido. Analizando imagen con IA y subiendo a Supabase Storage...');

          // 1. Descargar el buffer PRIMERO para pasarlo a Gemini (visión multimodal)
          const { buffer: mediaBuffer, contentType: mediaContentType, ext: mediaExt } = await descargarArchivoTelegram(archivoMultimedia.file_id);

          // 2. Generar propuesta con la imagen real (multimodal) si es foto; texto si es video
          let propuesta;
          const esVideoArchivo = ['mp4', 'mov', 'avi', 'mkv'].includes(mediaExt);
          if (!esVideoArchivo) {
            propuesta = await generarPropuestaConImagen(mediaBuffer, mediaContentType, caption || '');
          } else {
            propuesta = await generarPropuestaPublicacion('Reel / Video corto', caption || 'Video atractivo para redes sociales', 'Instagram');
          }
          const captionTexto = formatearCaptionIA(propuesta);

          // 3. Subir el buffer ya descargado a Supabase Storage
          const mediaUrl = await subirBufferASupabase(mediaBuffer, mediaContentType, mediaExt);
          let clienteId = '3da1634c-2f46-47d3-b098-3c1638f27e8c';
          const { data: clienteDB } = await supabase.from('clientes').select('id').limit(1).single();
          if (clienteDB) clienteId = clienteDB.id;

          const { data: nuevaPublicacion, error: dbError } = await supabase
            .from('publicaciones')
            .insert({
              cliente_id: clienteId,
              caption: captionTexto,
              tokens_usados: propuesta?.tokens || 0,
              media_url: mediaUrl,
              media_urls: [mediaUrl],
              plataformas: ['instagram', 'facebook', 'threads', 'tiktok'], // Ambos destinos activados por defecto
              tipo_publicacion: 'FEED',
              estado: 'borrador',
            })
            .select('id')
            .single();

          if (dbError) throw dbError;

          await registrarLog(nuevaPublicacion.id, 'PROPUESTA_GENERADA', 'INFO', {
            tokens: propuesta?.tokens,
            usage: propuesta?.usage,
          });

          await enviarPropuestaInteractivamente(chatId, nuevaPublicacion.id, propuesta, mediaUrl);
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

        // Acción: ver_agendados (botón de lista)
        if (data === 'ver_agendados') {
          await listarAgendados(chatId);
          return;
        }

        // Acción: force_publish_ (Publicar Ahora desde lista de agendados)
        if (data.startsWith('force_publish_')) {
          const publicacionId = data.replace('force_publish_', '');
          await sendMessage(chatId, `⏳ Procesando publicación inmediata para el ID \`${publicacionId}\`...`);
          await procesarAprobacionAsync(publicacionId, chatId);
          return;
        }

        // Acción: cancel_schedule_ (Cancelar agendamiento desde lista de agendados)
        if (data.startsWith('cancel_schedule_')) {
          const publicacionId = data.replace('cancel_schedule_', '');

          const { error: cancelScheduleError } = await supabase
            .from('publicaciones')
            .update({ estado: POST_STATUS.CANCELADO })
            .eq('id', publicacionId);

          if (cancelScheduleError) {
            await sendMessage(chatId, `❌ No se pudo cancelar la publicación \`${publicacionId}\`.`);
          } else {
            await sendMessage(chatId, `🗑️ *Publicación \`${publicacionId}\` cancelada correctamente.*`);
          }
          return;
        }

        const parts = data.split('_');
        const accion = parts[0];

        if (accion === 'cancelaragendado') {
          const pubId = parts.slice(1).join('_');

          const { error: cancelError } = await supabase
            .from('publicaciones')
            .update({ estado: POST_STATUS.RECHAZADO || 'RECHAZADO' })
            .eq('id', pubId);

          if (cancelError) {
            logger.error('Error cancelando publicación agendada:', cancelError);
            await sendMessage(chatId, '❌ No se pudo cancelar la publicación.');
            return;
          }

          await sendMessage(chatId, `🗑️ *Publicación programada cancelada con éxito.*`);

        } else if (accion === 'reprogramar') {
          const pubId = parts.slice(1).join('_');

          const { error: updateError } = await supabase
            .from('publicaciones')
            .update({ estado: 'PENDIENTE_FECHA' })
            .eq('id', pubId);

          if (updateError) {
            logger.error('Error al activar reprogramación:', updateError);
            await sendMessage(chatId, '❌ No se pudo activar la reprogramación.');
            return;
          }

          await sendMessage(
            chatId,
            `📅 *Reprogramación activada.*\n\nEscribe la nueva fecha y hora en formato:\n\`AAAA-MM-DD HH:MM\`\n\n*Ejemplo:* \`2026-09-10 18:30\``
          );

        } else if (accion === 'tipo') {
          const tipoSeleccionado = parts[1]; // 'FEED' o 'STORY'
          const realPublicacionId = parts.slice(2).join('_');

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
              `📅 *Modo programación activado.*\n\nEscribe la fecha y hora en la que deseas publicar usando el formato:\n\`AAAA-MM-DD HH:MM\`\n\n*Ejemplo:* \`2026-09-10 21:15\``
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
      } // Fin de if (update.callback_query)
    } catch (error) {
      logger.error('Error general en Telegram Webhook:', { error: error.message, stack: error.stack });
    }
  })();

  if (typeof waitUntil === 'function') {
    waitUntil(tareaWebhook);
  }
}

module.exports = { handleWebhook };