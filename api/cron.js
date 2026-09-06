const supabase = require('../src/config/supabase');
const { publicarEnInstagram } = require('../src/services/meta.service');
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

    // 2. Publicar cada post pendiente
    for (const pub of pendientes) {
      try {
        const { data: credsList } = await supabase
          .from('credenciales_redes')
          .select('*')
          .eq('cliente_id', pub.cliente_id)
          .eq('plataforma', 'instagram')
          .limit(1);

        const creds = credsList && credsList.length > 0 ? credsList[0] : null;
        const instagramAccountId = creds?.cuenta_id || process.env.INSTAGRAM_ACCOUNT_ID;
        const accessToken = creds?.token_acceso || process.env.META_ACCESS_TOKEN;

        if (!instagramAccountId || !accessToken) {
          throw new Error('No se encontraron las credenciales de Instagram.');
        }

        const resultado = await publicarEnInstagram(
          instagramAccountId,
          accessToken,
          pub.media_url,
          pub.caption
        );

        // Actualizar estado a PUBLICADO usando el estado de tus constantes
        const { error: updateError } = await supabase
          .from('publicaciones')
          .update({
            estado: POST_STATUS.PUBLICADO || 'PUBLICADO',
          })
          .eq('id', pub.id);

        if (updateError) {
          logger.error(`Error de Supabase al actualizar estado en post ${pub.id}:`, updateError);
          throw updateError;
        }

        // Notificar en Telegram
        const chatId = pub.clientes?.telegram_chat_id || process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (chatId) {
          await sendMessage(
            chatId,
            `⏰ *¡Publicación programada lanzada con éxito en Instagram!*\n\n` +
            `📌 *ID Post:* \`${resultado.postId}\``
          );
        }
      } catch (pubErr) {
        const metaErrorMsg = pubErr.response?.data?.error?.message 
          || (typeof pubErr.response?.data === 'object' ? JSON.stringify(pubErr.response?.data) : pubErr.message);

        logger.error(`Error publicando post programado ${pub.id}:`, { 
          error: metaErrorMsg,
          fullResponse: pubErr.response?.data 
        });
        
        // Forzar cambio de estado para evitar bucles infinitos
        await supabase
          .from('publicaciones')
          .update({ estado: POST_STATUS.RECHAZADO || 'ERROR' })
          .eq('id', pub.id);
      }
    }

    return res.status(200).json({ ok: true, procesadas: pendientes.length });
  } catch (error) {
    logger.error('Error en ejecución de Cron:', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
};