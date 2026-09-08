const axios = require('axios');
const logger = require('../config/logger');

const THREADS_API_URL = 'https://graph.threads.net/v1.0';

/**
 * Publica un post de texto con foto o video en Threads
 */
async function publicarEnThreads(threadsUserId, accessToken, mediaUrl, text) {
  try {
    const isVideo = typeof mediaUrl === 'string' && mediaUrl.toLowerCase().includes('.mp4');

    // STEP 1: Crear el contenedor en Threads
    logger.info('Creando contenedor en Threads...', { threadsUserId });
    const containerParams = {
      access_token: accessToken,
      media_type: isVideo ? 'VIDEO' : (mediaUrl ? 'IMAGE' : 'TEXT'),
      text: text,
      ...(mediaUrl && (isVideo ? { video_url: mediaUrl } : { image_url: mediaUrl })),
    };

    const containerRes = await axios.post(`${THREADS_API_URL}/${threadsUserId}/threads`, null, {
      params: containerParams,
    });
    const creationId = containerRes.data.id;

    // Si tiene media, esperamos 5 segundos para asegurar procesamiento
    if (mediaUrl) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // STEP 2: Publicar el contenedor
    logger.info('Publicando contenedor en Threads...', { creationId });
    const publishRes = await axios.post(`${THREADS_API_URL}/${threadsUserId}/threads_publish`, null, {
      params: {
        creation_id: creationId,
        access_token: accessToken,
      },
    });

    logger.info('Publicado exitosamente en Threads:', publishRes.data);
    return { postId: publishRes.data.id };

  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    logger.error('Error al publicar en Threads:', { error: errorMsg });
    throw new Error(`Threads API Error: ${errorMsg}`);
  }
}

module.exports = { publicarEnThreads };