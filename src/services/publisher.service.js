const supabase = require('../config/supabase');
const logger = require('../config/logger');
const { POST_STATUS, PLATFORMS } = require('../constants');
const { publicarEnInstagram } = require('./meta.service');
const { sendMessage } = require('./telegram.service');

/**
 * Registra un evento en la tabla de auditoría logs_publicacion si existe
 */
async function registrarLog(publicacionId, evento, nivel = 'INFO', payload = {}) {
  try {
    await supabase.from('logs_publicacion').insert({
      publicacion_id: publicacionId,
      evento,
      nivel,
      payload,
    });
  } catch (err) {
    // Si la tabla de logs no existe aún en la base de datos, ignorar silenciosamente
    logger.debug('No se pudo guardar log en logs_publicacion', { error: err.message });
  }
}

/**
 * Procesa la aprobación y publicación asíncrona de un contenido
 */
async function procesarAprobacionAsync(publicacionId, chatId) {
  logger.info('Iniciando flujo de procesamiento de publicación', { publicacionId, chatId });

  try {
    // 1. Obtener la publicación actual de Supabase
    const { data: publicacion, error: fetchErr } = await supabase
      .from('publicaciones')
      .select('*, clientes(*)')
      .eq('id', publicacionId)
      .single();

    if (fetchErr || !publicacion) {
      logger.warn('Publicación no encontrada en Supabase', { publicacionId });
      await sendMessage(chatId, '❌ No se encontró la publicación.');
      return;
    }

    if (publicacion.estado === POST_STATUS.PUBLICADO) {
      await sendMessage(chatId, '⚠️ Esta publicación ya fue publicada anteriormente.');
      return;
    }

// 2. Obtener credenciales de Instagram para el cliente
    const { data: creds, error: credsErr } = await supabase
      .from('credenciales_redes')
      .select('*')
      .eq('cliente_id', publicacion.cliente_id)
      .eq('plataforma', 'instagram') // Garantizamos minúsculas
      .maybeSingle();

    if (credsErr || !creds) {
      logger.error('Detalle error credenciales Supabase:', { 
        credsErr, 
        clienteIdBuscado: publicacion.cliente_id 
      });

      const errorMsg = '⚠️ Publicación aprobada, pero el cliente no tiene tokens de Instagram vinculados.';
      
      await supabase
        .from('publicaciones')
        .update({ estado: POST_STATUS.APROBADO })
        .eq('id', publicacionId);

      await registrarLog(publicacionId, 'FALLO_CREDENCIALES', 'WARN', { error: errorMsg, credsErr });
      await sendMessage(chatId, errorMsg);
      return;
    }

    // 3. Ejecutar publicación en Instagram
    const { postId } = await publicarEnInstagram(
      creds.cuenta_id,
      creds.token_acceso,
      publicacion.media_url,
      publicacion.caption
    );

    // 4. Actualizar estado exitoso en Supabase
    await supabase
      .from('publicaciones')
      .update({
        estado: POST_STATUS.PUBLICADO,
        instagram_post_id: postId,
      })
      .eq('id', publicacionId);

    await registrarLog(publicacionId, 'PUBLICACION_EXITOSA', 'INFO', { postId });

    await sendMessage(
      chatId,
      `🎉 ¡Publicado con éxito en Instagram! ID Post: \`${postId}\``
    );
  } catch (error) {
    logger.error('Error al publicar en Instagram', {
      publicacionId,
      error: error.message,
    });

    // Mantener como aprobado en caso de error de red o de API de Meta
    await supabase
      .from('publicaciones')
      .update({ estado: POST_STATUS.APROBADO })
      .eq('id', publicacionId);

    await registrarLog(publicacionId, 'PUBLICACION_FALLIDA', 'ERROR', { error: error.message });

    await sendMessage(
      chatId,
      `❌ Error al publicar en la API de Instagram. Revisa las credenciales o el video.`
    );
  }
}

/**
 * Procesa el rechazo de un borrador
 */
async function procesarRechazo(publicacionId, chatId) {
  try {
    const { error } = await supabase
      .from('publicaciones')
      .update({
        estado: POST_STATUS.RECHAZADO,
      })
      .eq('id', publicacionId);

    if (error) {
      throw error;
    }

    await registrarLog(publicacionId, 'PUBLICACION_RECHAZADA', 'INFO', { chatId });
    await sendMessage(chatId, `❌ Publicación \`${publicacionId}\` rechazada.`);
  } catch (err) {
    logger.error('Error al rechazar publicación', { publicacionId, error: err.message });
    await sendMessage(chatId, '❌ No se pudo actualizar el estado de rechazo en la base de datos.');
  }
}

module.exports = {
  procesarAprobacionAsync,
  procesarRechazo,
  registrarLog,
};
