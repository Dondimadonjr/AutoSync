const supabase = require('../src/config/supabase');
const { publicarEnInstagram, publicarStoryInstagram } = require('../src/services/meta.service');
const { sendMessage } = require('../src/services/telegram.service');
const logger = require('../src/config/logger');
const { POST_STATUS } = require('../src/constants');

module.exports = async function handler(req, res) {
  try {
    const ahora = new Date().toISOString();

    // 1. Obtener publicaciones programadas pendientes
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
      return res.status(200).json({ ok: true, procesadas: 0 });
    }

    logger.info(`Procesando ${pendientes.length} publicaciones programadas...`);

    // 2. Procesar cada publicación
    for (const pub of pendientes) {
      try {
        // Obtener credenciales desde credenciales_redes
        const { data: credsList, error: credsErr } = await supabase
          .from('credenciales_redes')
          .select('*')
          .eq('cliente_id', pub.cliente_id)
          .eq('plataforma', 'instagram')
          .limit(1);

        const creds = credsList && credsList.length > 0 ? credsList[0] : null;

        // Búsqueda exhaustiva del ID y Token
        const instagramAccountId = creds?.cuenta_id || creds?.instagram_account_id || process.env.INSTAGRAM_ACCOUNT_ID;
        const accessToken = creds?.token_acceso || creds?.access_token || process.env.META_ACCESS_TOKEN;

        if (!instagramAccountId || instagramAccountId === 'undefined') {
          throw new Error(`Cuenta de Instagram no válida para cliente ${pub.cliente_id}`);
        }

        let resultado;
        // Evaluar si la publicación programada es una Historia o Feed
        if (pub.tipo_publicacion === 'STORY') {
          const esVideo = pub.media_url.includes('.mp4');
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

        // Marcar como PUBLICADO
        const { error: updateErr } = await supabase
          .from('publicaciones')
          .update({
            estado: POST_STATUS.PUBLICADO || 'PUBLICADO',
            meta_post_id: resultado.postId,
            publicado_en: new Date().toISOString(),
          })
          .eq('id', pub.id);

        if (updateErr) throw updateErr;

        // Notificar en Telegram
        const chatId = pub.clientes?.telegram_chat_id || process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (chatId) {
          await sendMessage(
            chatId,
            `⏰ *¡Publicación programada (${pub.tipo_publicacion || 'FEED'}) lanzada en Instagram!*\n\n` +
            `📌 *ID Post:* \`${resultado.postId}\``
          );
        }
      } catch (pubErr) {
        const metaErrorMsg = pubErr.response?.data?.error?.message 
          || (typeof pubErr.response?.data === 'object' ? JSON.stringify(pubErr.response?.data) : pubErr.message);

        logger.error(`Error procesando post programado ${pub.id}:`, { error: metaErrorMsg });

        // Cambiar a RECHAZADO para romper el bucle infinito
        await supabase
          .from('publicaciones')
          .update({ estado: POST_STATUS.RECHAZADO || 'ERROR' })
          .eq('id', pub.id);
      }
    }

    return res.status(200).json({ ok: true, procesadas: pendientes.length });
  } catch (error) {
    logger.error('Error general en Cron:', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
};