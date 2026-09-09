const axios = require('axios');
const logger = require('../config/logger');

// URL base oficial para la API de Threads
const THREADS_API_URL = 'https://graph.threads.net/v1.0';

async function publicarEnThreads(threadsUserId, accessToken, mediaUrl, text) {
  try {
    const isVideo = typeof mediaUrl === 'string' && mediaUrl.toLowerCase().includes('.mp4');

    logger.info('Creando contenedor en Threads...', { threadsUserId });
    
    // STEP 1: Crear el contenedor
    const containerRes = await axios.post(`${THREADS_API_URL}/${threadsUserId}/threads`, null, {
      params: {
        access_token: accessToken,
        media_type: isVideo ? 'VIDEO' : (mediaUrl ? 'IMAGE' : 'TEXT'),
        text: text,
        ...(mediaUrl && (isVideo ? { video_url: mediaUrl } : { image_url: mediaUrl })),
      },
    });

    const creationId = containerRes.data.id;

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

    return { postId: publishRes.data.id };
  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    logger.error('Error al publicar en Threads:', { error: errorMsg });
    throw new Error(`Threads API Error: ${errorMsg}`);
  }
}

module.exports = { publicarEnThreads };