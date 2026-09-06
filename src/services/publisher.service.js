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
  
  let resultado;

  if (publicacion.tipo_publicacion === 'STORY') {
    // Comprobar si es un video o imagen según la extensión
    const esVideo = publicacion.media_url.includes('.mp4');
    resultado = await publicarStoryInstagram(
      creds.cuenta_id,
      creds.token_acceso,
      publicacion.media_url,
      esVideo
    );
  } else {
    resultado = await publicarEnInstagram(
      creds.cuenta_id,
      creds.token_acceso,
      publicacion.media_url,
      publicacion.caption
    );
  }

  try {
    // 1. Obtener credenciales de Instagram para el cliente
    const { data: credsList, error: credsErr } = await supabase
      .from('credenciales_redes')
      .select('*')
      .eq('cliente_id', publicacion.cliente_id)
      .eq('plataforma', 'instagram')
      .limit(1);

    const creds = credsList && credsList.length > 0 ? credsList[0] : null;

    // Extraer ID y Token con fallbacks (soporta cuenta_id o instagram_account_id)
    const instagramAccountId = creds?.cuenta_id || creds?.instagram_account_id || process.env.INSTAGRAM_ACCOUNT_ID;
    const accessToken = creds?.token_acceso || creds?.access_token || process.env.META_ACCESS_TOKEN;

    if (!instagramAccountId || instagramAccountId === 'undefined') {
      throw new Error('ID de cuenta de Instagram no encontrado en credenciales_redes ni en variables de entorno.');
    }

    // 2. Publicar según el formato elegido
    let resultado;
    if (publicacion.tipo_publicacion === 'STORY') {
      const esVideo = publicacion.media_url.includes('.mp4');
      resultado = await publicarStoryInstagram(
        instagramAccountId,
        accessToken,
        publicacion.media_url,
        esVideo
      );
    } else {
      resultado = await publicarEnInstagram(
        instagramAccountId,
        accessToken,
        publicacion.media_url,
        publicacion.caption
      );
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
    // Imprime la respuesta técnica devuelta por la API de Meta
    const metaErrorDetails = error.response?.data || error.message || error;
    logger.error('Error detallado al publicar en Instagram Meta API:', {
      publicacionId,
      errorMeta: metaErrorDetails
    });

    await supabase
      .from('publicaciones')
      .update({ estado: POST_STATUS.APROBADO })
      .eq('id', publicacionId);

    await registrarLog(publicacionId, 'PUBLICACION_FALLIDA', 'ERROR', { 
      error: typeof metaErrorDetails === 'object' ? JSON.stringify(metaErrorDetails) : metaErrorDetails 
    });

    await sendMessage(
      chatId,
      `❌ Error al publicar en Instagram:\n\`${JSON.stringify(metaErrorDetails)}\``
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
