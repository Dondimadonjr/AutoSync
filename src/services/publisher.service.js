const supabase = require('../config/supabase');
const logger = require('../config/logger');
const { POST_STATUS, PLATFORMS } = require('../constants');
const { publicarEnInstagram } = require('./meta.service');
const { sendMessage } = require('./telegram.service');

/**
 * Registra un evento en la tabla de auditoría logs_publicacion
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
    logger.warn('No se pudo guardar log en Supabase', { error: err.message });
  }
}

/**
 * Procesa la aprobación y publicación asíncrona de un contenido
 */
async function procesarAprobacionAsync(publicacionId, chatId) {
  logger.info('Iniciando flujo de procesamiento de publicación', { publicacionId, chatId });

  try {
    // 1. Bloqueo optimista: solo procesar si el estado es 'borrador'
    const { data: publicacion, error: fetchErr } = await supabase
      .from('publicaciones')
      .update({ estado: POST_STATUS.PROCESANDO, updated_at: new Date().toISOString() })
      .eq('id', publicacionId)
      .eq('estado', POST_STATUS.BORRADOR)
      .select()
      .single();

    if (fetchErr || !publicacion) {
      logger.warn('Intento de procesar publicación no disponible o ya en curso', { publicacionId });
      await sendMessage(chatId, '⚠️ Esta publicación ya fue procesada, aprobada previamente o rechazada.');
      return;
    }

    await registrarLog(publicacionId, 'INICIO_PROCESAMIENTO', 'INFO', { chatId });
    await sendMessage(chatId, '⏳ *Procesando video...*\nSubiendo y transcodificando en Meta Graph API.');

    // 2. Obtener credenciales de Instagram para el cliente
    const { data: creds, error: credsErr } = await supabase
      .from('credenciales_redes')
      .select('*')
      .eq('cliente_id', publicacion.cliente_id)
      .eq('plataforma', PLATFORMS.INSTAGRAM)
      .single();

    if (credsErr || !creds) {
      const errorMsg = 'El cliente no tiene credenciales válidas de Instagram registradas.';
      logger.error(errorMsg, { clienteId: publicacion.cliente_id });

      await supabase
        .from('publicaciones')
        .update({
          estado: POST_STATUS.FALLIDO,
          error_detalle: errorMsg,
          updated_at: new Date().toISOString(),
        })
        .eq('id', publicacionId);

      await registrarLog(publicacionId, 'FALLO_CREDENCIALES', 'ERROR', { error: errorMsg });
      await sendMessage(chatId, `❌ *Fallo en la publicación:*\n${errorMsg}`);
      return;
    }

    // 3. Ejecutar publicación en Instagram
    const { postId, containerId } = await publicarEnInstagram(
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
        instagram_container_id: containerId,
        instagram_post_id: postId,
        error_detalle: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', publicacionId);

    await registrarLog(publicacionId, 'PUBLICACION_EXITOSA', 'INFO', { postId, containerId });

    await sendMessage(
      chatId,
      `🎉 *¡Publicado exitosamente en Instagram!*\n\n🆔 *Post ID:* \`${postId}\`\n✅ Estado: *En línea*`
    );
  } catch (error) {
    logger.error('Error durante la publicación en Instagram', {
      publicacionId,
      error: error.message,
    });

    await supabase
      .from('publicaciones')
      .update({
        estado: POST_STATUS.FALLIDO,
        error_detalle: error.message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', publicacionId);

    await registrarLog(publicacionId, 'PUBLICACION_FALLIDA', 'ERROR', { error: error.message });

    await sendMessage(
      chatId,
      `❌ *Error al publicar en Instagram:*\n_${error.message}_\n\nLa publicación quedó registrada como \`fallido\`.`
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
        updated_at: new Date().toISOString(),
      })
      .eq('id', publicacionId);

    if (error) {
      throw error;
    }

    await registrarLog(publicacionId, 'PUBLICACION_RECHAZADA', 'INFO', { chatId });
    await sendMessage(chatId, `🚫 Publicación \`${publicacionId}\` rechazada por el usuario.`);
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
