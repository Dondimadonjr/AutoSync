const supabase = require('../src/config/supabase');
const { publicarEnInstagram, publicarStoryInstagram } = require('../src/services/meta.service');
const { sendMessage } = require('../src/services/telegram.service');
const logger = require('../src/config/logger');
const { POST_STATUS } = require('../src/constants');

module.exports = async function handler(req, res) {
  try {
    const ahora = new Date().toISOString();
    logger.info(`[CRON] Verificando publicaciones pendientes a las: ${ahora}`);

    // 1. Obtener publicaciones programadas cuya fecha/hora sea igual o anterior a la hora actual
    const { data: pendientes, error } = await supabase
      .from('publicaciones')
      .select('*, clientes(*)')
      .eq('estado', POST_STATUS.PROGRAMADO || 'PROGRAMADO')
      .lte('programado_para', ahora);

    if (error) {
      logger.error('Error al consultar Supabase en Cron:', error);
      return res.status(200).json({ ok: false, error: error.message });
    }

    if (!pendientes || pendientes.length === 0) {
      logger.info('[CRON] No hay publicaciones pendientes por publicar.');
      return res.status(200).json({ ok: true, procesadas: 0 });
    }

    logger.info(`[CRON] Procesando ${pendientes.length} publicación(es) programada(s)...`);

    // 2. Procesar cada publicación pendiente
    for (const pub of pendientes) {
      try {
        // Obtener credenciales explícitas asociadas al cliente
        const { data: credsList, error: credsErr } = await supabase
          .from('credenciales_redes')
          .select('*')
          .eq('cliente_id', pub.cliente_id)
          .eq('plataforma', 'instagram')
          .limit(1);

        const creds = credsList && credsList.length > 0 ? credsList[0] : null;

        // Búsqueda exhaustiva con fallbacks seguros
        const instagramAccountId = creds?.cuenta_id || creds?.instagram_account_id || process.env.INSTAGRAM_ACCOUNT_ID;
        const accessToken = creds?.token_acceso || creds?.access_token || process.env.META_ACCESS_TOKEN;

        if (!instagramAccountId || instagramAccountId === 'undefined') {
          throw new Error(`Cuenta de Instagram no válida para el cliente: ${pub.cliente_id}`);
        }

        let resultado;

        // Evaluar el tipo de publicación (Story o Feed)
        if (pub.tipo_publicacion === 'STORY') {
          const esVideo = pub.media_url ? pub.media_url.includes('.mp4') : false;
          resultado = await publicarStoryInstagram(
            instagramAccountId,
            accessToken,
            pub.media_url,
            esVideo
          );
        } else {
          resultado = await publicarEnInstagram(
            instagramAccountId,
            accessToken,
            pub.media_url,
            pub.caption
          );
        }

        // Preparar payload de actualización seguro
        const updatePayload = {
          estado: POST_STATUS.PUBLICADO || 'PUBLICADO',
          publicado_en: new Date().toISOString()
        };

        // Si la columna meta_post_id existe o la manejas en Supabase, la incluye
        if (resultado?.postId) {
          updatePayload.meta_post_id = resultado.postId;
        }

        // Marcar como PUBLICADO en Supabase
        const { error: updateErr } = await supabase
          .from('publicaciones')
          .update(updatePayload)
          .eq('id', pub.id);

        if (updateErr) {
          // Si el error es por falta de columna meta_post_id, reintentar sin ella
          if (updateErr.code === 'PGRST204') {
            delete updatePayload.meta_post_id;
            const { error: retryErr } = await supabase
              .from('publicaciones')
              .update(updatePayload)
              .eq('id', pub.id);

            if (retryErr) throw retryErr;
          } else {
            throw updateErr;
          }
        }

        // Notificar al chat de Telegram
        const chatId = pub.clientes?.telegram_chat_id || process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (chatId) {
          const tipoTexto = pub.tipo_publicacion === 'STORY' ? 'Historia / Story' : 'Feed';
          await sendMessage(
            chatId,
            `⏰ *¡Publicación programada (${tipoTexto}) lanzada con éxito en Instagram!*\n\n` +
            `📌 *ID Post:* \`${resultado?.postId || 'N/A'}\``
          );
        }

      } catch (pubErr) {
        const metaErrorMsg = pubErr.response?.data?.error?.message 
          || (typeof pubErr.response?.data === 'object' ? JSON.stringify(pubErr.response?.data) : pubErr.message);

        logger.error(`Error procesando post programado ${pub.id}:`, { error: metaErrorMsg });

        // Marcar estado como ERROR / RECHAZADO para romper bucles repetitivos
        await supabase
          .from('publicaciones')
          .update({ estado: POST_STATUS.RECHAZADO || 'ERROR' })
          .eq('id', pub.id);
      }
    }

    return res.status(200).json({ ok: true, procesadas: pendientes.length });
  } catch (error) {
    logger.error('Error general en ejecución de Cron:', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
};