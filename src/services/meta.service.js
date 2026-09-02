const axios = require('axios');
const logger = require('../config/logger');
const { META_GRAPH_BASE_URL } = require('../constants');

/**
 * Consulta el estado de procesamiento del contenedor de Reels en Meta Graph API
 * @param {string} containerId ID del contenedor multimedia
 * @param {string} accessToken Token de acceso
 * @param {number} maxAttempts Número máximo de sondeos
 * @param {number} intervalMs Milisegundos entre cada consulta
 */
async function esperarContenedorListo(containerId, accessToken, maxAttempts = 12, intervalMs = 2500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(`${META_GRAPH_BASE_URL}/${containerId}`, {
        params: {
          fields: 'status_code,status',
          access_token: accessToken,
        },
      });

      const { status_code, status } = response.data;
      logger.info('Estado de transcodificación del contenedor en Meta', {
        containerId,
        attempt,
        status_code,
        status,
      });

      if (status_code === 'FINISHED') {
        return true;
      }

      if (status_code === 'ERROR' || status_code === 'EXPIRED') {
        throw new Error(`El contenedor de video falló en Meta con estado: ${status_code} (${status || 'Sin detalle'})`);
      }

      // Si sigue IN_PROGRESS, esperar para el siguiente intento
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } catch (err) {
      if (err.message.includes('El contenedor de video falló')) {
        throw err;
      }
      logger.warn(`Error sondeando estado del contenedor [${containerId}] intento ${attempt}`, {
        error: err.response?.data || err.message,
      });
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`Tiempo de espera agotado (${(maxAttempts * intervalMs) / 1000}s) esperando que Meta procese el video.`);
}

/**
 * Publica un Reel en una cuenta de Instagram Business
 * @param {string} instagramAccountId ID de la cuenta de Instagram Business
 * @param {string} accessToken Token de acceso (System User Token o Long-Lived Token)
 * @param {string} videoUrl URL pública directa del video
 * @param {string} caption Texto del post con hashtags
 * @returns {Promise<{ postId: string, containerId: string }>}
 */
async function publicarEnInstagram(instagramAccountId, accessToken, videoUrl, caption) {
  try {
    logger.info('Iniciando creación de contenedor en Meta Graph API', { instagramAccountId });

    // 1. Crear el contenedor multimedia para REELS
    const containerRes = await axios.post(`${META_GRAPH_BASE_URL}/${instagramAccountId}/media`, {
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      access_token: accessToken,
    });

    const containerId = containerRes.data.id;
    logger.info('Contenedor creado exitosamente en Meta', { containerId });

    // 2. Esperar activamente a que Meta finalice el procesamiento del video
    await esperarContenedorListo(containerId, accessToken);

    // 3. Publicar el contenedor listo
    const publishRes = await axios.post(`${META_GRAPH_BASE_URL}/${instagramAccountId}/media_publish`, {
      creation_id: containerId,
      access_token: accessToken,
    });

    const postId = publishRes.data.id;
    logger.info('Reel publicado exitosamente en Instagram', { postId, containerId });

    return { postId, containerId };
  } catch (error) {
    const errorData = error.response?.data?.error;
    const errorMessage = errorData
      ? `Meta API Error (${errorData.code}): ${errorData.message} - ${errorData.error_user_msg || ''}`
      : error.message;

    logger.error('Fallo en la publicación con Meta Graph API', {
      error: errorMessage,
      details: error.response?.data,
    });

    throw new Error(errorMessage);
  }
}

module.exports = {
  publicarEnInstagram,
  esperarContenedorListo,
};
