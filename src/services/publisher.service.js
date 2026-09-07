const supabase = require('../config/supabase');
const logger = require('../config/logger');
const { POST_STATUS } = require('../constants');
const { 
  publicarEnInstagram, 
  publicarStoryInstagram,
  publicarCarruselInstagram,
  publicarReelInstagram,
  publicarEnFacebook
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
 * Procesa la aprobación y publicación asíncrona de contenido en Instagram y/o Facebook Pages
 */
async function procesarAprobacionAsync(publicacionId, chatId) {
  logger.info('Iniciando flujo de procesamiento de publicación', { publicacionId, chatId });

  try {
    // 1. Obtener la publicación de Supabase
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

    // 2. Normalizar la lista de URLs (garantiza arreglo con fallback a media_url)
    const listaUrls = Array.isArray(publicacion.media_urls) && publicacion.media_urls.length > 0
      ? publicacion.media_urls
      : (publicacion.media_url ? [publicacion.media_url] : []);

    const esVideo = publicacion.media_url?.toLowerCase().includes('.mp4');
    const plataformas = publicacion.plataformas || ['instagram'];
    const resultados = [];

    // ---------------------------------------------------------------------
    // A. PUBLICAR EN INSTAGRAM
    // ---------------------------------------------------------------------
    if (plataformas.includes('instagram')) {
      const { data: credsList } = await supabase
        .from('credenciales_redes')
        .select('*')
        .eq('cliente_id', publicacion.cliente_id)
        .eq('plataforma', 'instagram')
        .limit(1);

      const creds = credsList && credsList.length > 0 ? credsList[0] : null;
      const instagramAccountId = creds?.cuenta_id || creds?.instagram_account_id || process.env.INSTAGRAM_ACCOUNT_ID;
      const igAccessToken = creds?.token_acceso || creds?.access_token || process.env.META_ACCESS_TOKEN;

      if (!instagramAccountId || instagramAccountId === 'undefined') {
        logger.warn('Credenciales de Instagram no encontradas, saltando Instagram...', { clienteId: publicacion.cliente_id });
      } else {
        let resIg;
        let formatoTexto = 'Feed';

        if (listaUrls.length > 1 || publicacion.tipo_publicacion === 'CAROUSEL') {
          resIg = await publicarCarruselInstagram(instagramAccountId, igAccessToken, listaUrls, publicacion.caption);
          formatoTexto = 'Carrusel';
        } else if (publicacion.tipo_publicacion === 'STORY') {
          resIg = await publicarStoryInstagram(instagramAccountId, igAccessToken, publicacion.media_url, esVideo);
          formatoTexto = 'Historia / Story';
        } else if (esVideo) {
          resIg = await publicarReelInstagram(instagramAccountId, igAccessToken, publicacion.media_url, publicacion.caption);
          formatoTexto = 'Reel';
        } else {
          resIg = await publicarEnInstagram(instagramAccountId, igAccessToken, publicacion.media_url, publicacion.caption);
          formatoTexto = 'Feed';
        }

        resultados.push(`📸 *Instagram (${formatoTexto}):* ID \`${resIg.postId}\``);
      }
    }

    // ---------------------------------------------------------------------
    // B. PUBLICAR EN FACEBOOK PAGE
    // ---------------------------------------------------------------------
    if (plataformas.includes('facebook')) {
      const { data: credsFbList } = await supabase
        .from('credenciales_redes')
        .select('*')
        .eq('cliente_id', publicacion.cliente_id)
        .eq('plataforma', 'facebook')
        .limit(1);

      const credsFb = credsFbList && credsFbList.length > 0 ? credsFbList[0] : null;
      const facebookPageId = credsFb?.cuenta_id || process.env.FACEBOOK_PAGE_ID;
      const fbAccessToken = credsFb?.token_acceso || process.env.META_ACCESS_TOKEN;

      if (!facebookPageId || facebookPageId === 'undefined') {
        logger.warn('Credenciales de Facebook no encontradas, saltando Facebook...', { clienteId: publicacion.cliente_id });
      } else {
        const resFb = await publicarEnFacebook(facebookPageId, fbAccessToken, publicacion.media_url, publicacion.caption);
        resultados.push(`📘 *Facebook Page:* ID \`${resFb.postId}\``);
      }
    }

    if (resultados.length === 0) {
      throw new Error('No se pudo publicar en ninguna red social. Verifica las credenciales configuradas.');
    }

    // 3. Actualizar estado a PUBLICADO en Supabase
    const payloadUpdate = {
      estado: POST_STATUS.PUBLICADO || 'PUBLICADO',
      publicado_en: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from('publicaciones')
      .update(payloadUpdate)
      .eq('id', publicacionId);

    if (updateError) {
      logger.error(`Error de Supabase al actualizar estado en post ${publicacionId}:`, updateError);
    }

    await registrarLog(publicacionId, 'PUBLICACION_EXITOSA', 'INFO', { resultados });

    // 4. Notificar confirmación en Telegram
    const resumen = resultados.join('\n');
    await sendMessage(chatId, `🎉 *¡Publicado exitosamente!*\n\n${resumen}`);

  } catch (error) {
    const errorDetails = error.response?.data?.error?.message 
      || (typeof error.response?.data === 'object' ? JSON.stringify(error.response?.data) : error.message);

    logger.error('Error detallado al publicar:', {
      publicacionId,
      error: errorDetails,
    });

    await supabase
      .from('publicaciones')
      .update({ estado: POST_STATUS.RECHAZADO || 'ERROR' })
      .eq('id', publicacionId);

    await registrarLog(publicacionId, 'PUBLICACION_FALLIDA', 'ERROR', { 
      error: typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : errorDetails,
    });

    await sendMessage(
      chatId,
      `❌ *Error al publicar:*\n\`${errorDetails}\``
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