const supabase = require('../config/supabase');
const env = require('../config/env');
const logger = require('../config/logger');
const { POST_STATUS } = require('../constants');
const { generarPropuestaPublicacion } = require('../services/ai.service');
const { enviarPropuestaInteractivamente } = require('../services/telegram.service');
const { registrarLog } = require('../services/publisher.service');

/**
 * Endpoint POST /generar-post
 * Responde 202 Accepted de inmediato y ejecuta en segundo plano
 */
async function generarPost(req, res, _next) {
  const { clienteId, producto, descripcion, mediaUrl, chatId, plataformas } = req.body;

  // 1. Responder INMEDIATAMENTE al cliente para evitar cualquier timeout de Vercel (<50ms)
  res.status(202).json({
    status: 'procesando',
    message: 'Solicitud recibida. La propuesta se está generando en segundo plano y llegará a Telegram.',
  });

  // 2. Ejecutar la generación, persistencia y envío a Telegram en segundo plano
  (async () => {
    try {
      logger.info('Iniciando procesamiento en segundo plano de post', { clienteId, producto });

      // Determinar el Chat ID de Telegram (Body > DB Cliente > .env)
      let targetChatId = chatId;
      if (!targetChatId) {
        const { data: cliente } = await supabase
          .from('clientes')
          .select('telegram_chat_id')
          .eq('id', clienteId)
          .single();

        targetChatId = cliente?.telegram_chat_id || env.TELEGRAM_CHAT_ID;
      }

      if (!targetChatId) {
        logger.error('No se pudo determinar el Chat ID de Telegram en segundo plano', { clienteId });
        return;
      }

      // Generar propuesta con Gemini
      const propuesta = await generarPropuestaPublicacion(producto, descripcion);
      const captionCompleto = `${propuesta.caption}\n\n${propuesta.hashtags.join(' ')}`;

      // Guardar borrador en Supabase
      const { data: publicacion, error: dbError } = await supabase
        .from('publicaciones')
        .insert({
          cliente_id: clienteId,
          caption: captionCompleto,
          media_url: mediaUrl,
          plataformas: plataformas || ['instagram'],
          estado: POST_STATUS.BORRADOR,
        })
        .select()
        .single();

      if (dbError || !publicacion) {
        logger.error('Error insertando publicación en Supabase en segundo plano', { error: dbError });
        return;
      }

      await registrarLog(publicacion.id, 'BORRADOR_CREADO', 'INFO', { producto, clienteId });

      // Enviar tarjeta interactiva a Telegram
      const telegramRes = await enviarPropuestaInteractivamente(
        targetChatId,
        publicacion.id,
        propuesta,
        mediaUrl
      );

      logger.info('✅ Borrador generado y enviado a Telegram exitosamente en segundo plano', {
        publicacionId: publicacion.id,
        chatId: targetChatId,
        messageId: telegramRes?.result?.message_id,
      });
    } catch (error) {
      logger.error('❌ Error procesando en segundo plano:', {
        error: error.message || error,
        stack: error.stack,
      });
    }
  })();
}

module.exports = {
  generarPost,
};
