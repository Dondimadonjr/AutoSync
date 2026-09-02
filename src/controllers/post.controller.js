const supabase = require('../config/supabase');
const env = require('../config/env');
const logger = require('../config/logger');
const { POST_STATUS } = require('../constants');
const { generarPropuestaPublicacion } = require('../services/ai.service');
const { enviarPropuestaInteractivamente } = require('../services/telegram.service');
const { registrarLog } = require('../services/publisher.service');

/**
 * Endpoint POST /generar-post
 * Genera propuesta con IA, guarda borrador en Supabase y despacha a Telegram
 */
async function generarPost(req, res, next) {
  try {
    const { clienteId, producto, descripcion, mediaUrl, chatId, plataformas } = req.body;

    logger.info('Iniciando generación de propuesta de post', { clienteId, producto });

    // 1. Resolver el chatId de Telegram (Body > DB Cliente > .env)
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
      return res.status(400).json({
        status: 'error',
        message: 'No se pudo determinar el Chat ID de Telegram para notificar al usuario.',
      });
    }

    // 2. Generar propuesta creativa con Gemini (con retry y validación Zod)
    const propuesta = await generarPropuestaPublicacion(producto, descripcion);
    const captionCompleto = `${propuesta.caption}\n\n${propuesta.hashtags.join(' ')}`;

    // 3. Crear registro en Supabase
    const { data: publicacion, error: dbError } = await supabase
      .from('publicaciones')
      .insert({
        cliente_id: clienteId,
        caption: captionCompleto,
        media_url: mediaUrl,
        sugerencia_visual: propuesta.sugerencia_visual,
        plataformas: plataformas || ['instagram'],
        estado: POST_STATUS.BORRADOR,
      })
      .select()
      .single();

    if (dbError || !publicacion) {
      logger.error('Error insertando publicación en Supabase', { error: dbError });
      throw new Error(`Error en base de datos: ${dbError?.message}`);
    }

    await registrarLog(publicacion.id, 'BORRADOR_CREADO', 'INFO', { producto, clienteId });

    // 4. Enviar tarjeta interactiva con botones a Telegram
    const telegramRes = await enviarPropuestaInteractivamente(
      targetChatId,
      publicacion.id,
      propuesta,
      mediaUrl
    );

    // Guardar el message_id de Telegram para referencia
    if (telegramRes?.result?.message_id) {
      await supabase
        .from('publicaciones')
        .update({ telegram_message_id: telegramRes.result.message_id })
        .eq('id', publicacion.id);
    }

    logger.info('Propuesta enviada a Telegram exitosamente', {
      publicacionId: publicacion.id,
      chatId: targetChatId,
      messageId: telegramRes?.result?.message_id,
    });

    res.status(201).json({
      status: 'success',
      message: 'Borrador generado y enviado a Telegram para aprobación',
      data: {
        publicacionId: publicacion.id,
        messageId: telegramRes?.result?.message_id,
        propuesta,
        estado: publicacion.estado,
      },
    });
  } catch (error) {
    logger.error('Error en generarPost:', {
      error: error.message,
      stack: error.stack,
      body: req.body,
    });
    next(error);
  }
}

module.exports = {
  generarPost,
};
