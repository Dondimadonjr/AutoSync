const { waitUntil } = require('@vercel/functions');
const supabase = require('../config/supabase');
const env = require('../config/env');
const logger = require('../config/logger');
const { POST_STATUS } = require('../constants');
const { generarPropuestaPublicacion } = require('../services/ai.service');
const { enviarPropuestaInteractivamente } = require('../services/telegram.service');
const { registrarLog } = require('../services/publisher.service');

/**
 * Endpoint POST /generar-post
 * Responde 202 Accepted de inmediato y mantiene la función viva en Vercel con waitUntil
 */
async function generarPost(req, res, _next) {
  const { clienteId, producto, descripcion, mediaUrl, chatId, plataformas } = req.body;

  // 1. Definir la promesa de fondo que ejecutará Gemini + Supabase + Telegram
  const tareaFondo = (async () => {
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

      // Generar propuesta creativa con Gemini
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

  // 2. Notificar a Vercel que mantenga viva la ejecución hasta que tareaFondo termine
  if (typeof waitUntil === 'function') {
    waitUntil(tareaFondo);
  }

  // 3. Responder de inmediato al cliente HTTP (202 Accepted)
  return res.status(202).json({
    status: 'procesando',
    message: 'Solicitud recibida. La propuesta se está generando en segundo plano y llegará a Telegram.',
  });
}

module.exports = {
  generarPost,
};
