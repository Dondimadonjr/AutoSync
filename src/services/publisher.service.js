const supabase = require('../config/supabase');
const logger = require('../config/logger');
const { POST_STATUS } = require('../constants');
const { 
  publicarEnInstagram, 
  publicarStoryInstagram,
  publicarCarruselInstagram,
  publicarReelInstagram
} = require('./meta.service');
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
    logger.debug('No se pudo guardar log en logs_publicacion:', { error: err.message });
  }
}

/**
 * Procesa la aprobación y publicación asíncrona de un contenido en Instagram (Feed, Story o Carrusel)
 */
async function procesarAprobacionAsync(publicacionId, chatId) {
  logger.info('Iniciando flujo de procesamiento de publicación', { publicacionId, chatId });

  try {
    // 1. Obtener publicación de Supabase
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

    if (publicacion.estado === (POST_STATUS.PUBLICADO || 'PUBLICADO')) {
      await sendMessage(chatId, '⚠️ Esta publicación ya fue publicada anteriormente.');
      return;
    }

    // 2. Obtener credenciales de Instagram
    const { data: credsList, error: credsErr } = await supabase
      .from('credenciales_redes')
      .select('*')
      .eq('cliente_id', publicacion.cliente_id)
      .eq('plataforma', 'instagram')
      .limit(1);

    const creds = credsList && credsList.length > 0 ? credsList[0] : null;

    const instagramAccountId = creds?.cuenta_id || creds?.instagram_account_id || process.env.INSTAGRAM_ACCOUNT_ID;
    const accessToken = creds?.token_acceso || creds?.access_token || process.env.META_ACCESS_TOKEN;

    if (!instagramAccountId || instagramAccountId === 'undefined') {
      const errorMsg = '⚠️ No se encontraron las credenciales o el ID de cuenta de Instagram vinculado.';
      logger.error(errorMsg, { clienteId: publicacion.cliente_id });
      await sendMessage(chatId, errorMsg);
      return;
    }

    // 3. Normalizar la lista de URLs (garantiza arreglo con fallback a media_url)
    const listaUrls = Array.isArray(publicacion.media_urls) && publicacion.media_urls.length > 0
      ? publicacion.media_urls
      : (publicacion.media_url ? [publicacion.media_url] : []);

    const { 
  publicarEnInstagram, 
  publicarStoryInstagram,
  publicarCarruselInstagram,
  publicarReelInstagram
} = require('./meta.service');

// En el Paso 3 dentro de procesarAprobacionAsync:

    let resultado;
    let formatoTexto = 'Feed';
    const esVideo = publicacion.media_url?.toLowerCase().includes('.mp4');

    // Evaluaciones por formato
    if (listaUrls.length > 1 || publicacion.tipo_publicacion === 'CAROUSEL') {
      resultado = await publicarCarruselInstagram(
        instagramAccountId,
        accessToken,
        listaUrls,
        publicacion.caption
      );
      formatoTexto = 'Carrusel';

    } else if (publicacion.tipo_publicacion === 'STORY') {
      resultado = await publicarStoryInstagram(
        instagramAccountId,
        accessToken,
        publicacion.media_url,
        esVideo
      );
      formatoTexto = 'Historia / Story';

    } else if (esVideo) {
      // Si es un archivo único de vídeo (.mp4), se publica como REEL
      resultado = await publicarReelInstagram(
        instagramAccountId,
        accessToken,
        publicacion.media_url,
        publicacion.caption
      );
      formatoTexto = 'Reel';

    } else {
      // Imagen estática para Feed
      resultado = await publicarEnInstagram(
        instagramAccountId,
        accessToken,
        publicacion.media_url,
        publicacion.caption
      );
      formatoTexto = 'Feed';
    }

    const postId = resultado.postId;

    // 4. Actualizar estado a PUBLICADO en Supabase (con fallback seguro para meta_post_id)
    const payloadUpdate = {
      estado: POST_STATUS.PUBLICADO || 'PUBLICADO',
      meta_post_id: postId,
      publicado_en: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from('publicaciones')
      .update(payloadUpdate)
      .eq('id', publicacionId);

    if (updateError) {
      if (updateError.code === 'PGRST204') {
        // La columna meta_post_id no existe en la BD, reintentar sin ella
        delete payloadUpdate.meta_post_id;
        await supabase
          .from('publicaciones')
          .update(payloadUpdate)
          .eq('id', publicacionId);
      } else {
        logger.error(`Error de Supabase al actualizar estado en post ${publicacionId}:`, updateError);
      }
    }

    await registrarLog(publicacionId, 'PUBLICACION_EXITOSA', 'INFO', { postId, formato: formatoTexto });

    // 5. Notificar confirmación en Telegram
    await sendMessage(
      chatId,
      `🎉 *¡Publicado con éxito en Instagram (${formatoTexto})!*\n📌 *ID Post:* \`${postId}\``
    );

  } catch (error) {
    const metaErrorDetails = error.response?.data?.error?.message 
      || (typeof error.response?.data === 'object' ? JSON.stringify(error.response?.data) : error.message);

    logger.error('Error detallado al publicar en Instagram Meta API:', {
      publicacionId,
      errorMeta: metaErrorDetails,
    });

    await supabase
      .from('publicaciones')
      .update({ estado: POST_STATUS.RECHAZADO || 'ERROR' })
      .eq('id', publicacionId);

    await registrarLog(publicacionId, 'PUBLICACION_FALLIDA', 'ERROR', { 
      error: typeof metaErrorDetails === 'object' ? JSON.stringify(metaErrorDetails) : metaErrorDetails,
    });

    await sendMessage(
      chatId,
      `❌ *Error al publicar en Instagram:*\n\`${metaErrorDetails}\``
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
        estado: POST_STATUS.RECHAZADO || 'RECHAZADO',
      })
      .eq('id', publicacionId);

    if (error) throw error;

    await registrarLog(publicacionId, 'PUBLICACION_RECHAZADA', 'INFO', { chatId });
    await sendMessage(chatId, `❌ Publicación \`${publicacionId}\` rechazada.`);
  } catch (err) {
    logger.error('Error al rechazar publicación:', { publicacionId, error: err.message });
    await sendMessage(chatId, '❌ No se pudo actualizar el estado de rechazo en la base de datos.');
  }
}

module.exports = {
  procesarAprobacionAsync,
  procesarRechazo,
  registrarLog,
};