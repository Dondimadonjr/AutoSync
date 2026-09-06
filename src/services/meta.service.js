const axios = require('axios');
const logger = require('../config/logger');

const GRAPH_API_URL = 'https://graph.facebook.com/v19.0';

/**
 * Espera activamente a que Meta termine de procesar un contenedor multimedia (status_code === 'FINISHED')
 */
async function esperarProcesamientoMeta(containerId, accessToken, maxIntentos = 10) {
  const checkUrl = `${GRAPH_API_URL}/${containerId}`;
  
  for (let i = 0; i < maxIntentos; i++) {
    const res = await axios.get(checkUrl, {
      params: { 
        fields: 'status_code,status', 
        access_token: accessToken 
      }
    });

    const statusCode = res.data?.status_code;
    logger.info(`Estado del contenedor Meta (${containerId}): ${statusCode}`);

    if (statusCode === 'FINISHED') {
      return true;
    }

    if (statusCode === 'ERROR') {
      throw new Error(`El procesamiento del archivo multimedia falló en Meta: ${res.data?.status || 'Error desconocido'}`);
    }

    // Esperar 3 segundos antes de reintentar
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error('Tiempo de espera agotado: Meta tardó demasiado en procesar el archivo multimedia.');
}

/**
 * Publica una foto o video estándar (Reel) en el Feed de Instagram
 */
async function publicarEnInstagram(igAccountId, accessToken, mediaUrl, caption) {
  const isVideo = mediaUrl.includes('.mp4');
  const containerUrl = `${GRAPH_API_URL}/${igAccountId}/media`;
  
  const containerParams = {
    access_token: accessToken,
    caption: caption,
    [isVideo ? 'video_url' : 'image_url']: mediaUrl,
    ...(isVideo && { media_type: 'REELS' }),
  };

  const containerRes = await axios.post(containerUrl, null, { params: containerParams });
  const creationId = containerRes.data.id;

  // Esperar a que el contenedor sea procesado por Meta
  await esperarProcesamientoMeta(creationId, accessToken);

  const publishUrl = `${GRAPH_API_URL}/${igAccountId}/media_publish`;
  const publishRes = await axios.post(publishUrl, null, {
    params: { creation_id: creationId, access_token: accessToken },
  });

  return { postId: publishRes.data.id };
}

/**
 * Publica una Historia (Story) en Instagram
 */
async function publicarStoryInstagram(igAccountId, accessToken, mediaUrl, isVideo = false) {
  const containerUrl = `${GRAPH_API_URL}/${igAccountId}/media`;
  const containerParams = {
    access_token: accessToken,
    media_type: 'STORIES',
    [isVideo ? 'video_url' : 'image_url']: mediaUrl,
  };

  const containerRes = await axios.post(containerUrl, null, { params: containerParams });
  const creationId = containerRes.data.id;

  // Esperar a que la Story esté lista
  await esperarProcesamientoMeta(creationId, accessToken);

  const publishUrl = `${GRAPH_API_URL}/${igAccountId}/media_publish`;
  const publishRes = await axios.post(publishUrl, null, {
    params: { creation_id: creationId, access_token: accessToken },
  });

  return { postId: publishRes.data.id };
}

/**
 * Publica un Carrusel (múltiples fotos/videos) en Instagram
 */
async function publicarCarruselInstagram(igAccountId, accessToken, mediaUrls, caption) {
  const itemContainerIds = [];

  // 1. Crear contenedores para cada ítem del carrusel
  for (const media of mediaUrls) {
    const isVideo = typeof media === 'object' ? media.isVideo : media.endsWith('.mp4');
    const url = typeof media === 'object' ? media.url : media;

    const containerParams = {
      access_token: accessToken,
      is_carousel_item: true,
      [isVideo ? 'video_url' : 'image_url']: url,
    };

    const itemRes = await axios.post(
      `${GRAPH_API_URL}/${igAccountId}/media`,
      null,
      { params: containerParams }
    );
    itemContainerIds.push(itemRes.data.id);
  }

  // 2. Verificar que todos los elementos individuales estén procesados
  for (const itemId of itemContainerIds) {
    await esperarProcesamientoMeta(itemId, accessToken);
  }

  // 3. Crear el contenedor principal del Carrusel
  const carouselParams = {
    access_token: accessToken,
    media_type: 'CAROUSEL',
    children: itemContainerIds.join(','),
    caption: caption,
  };

  const carouselRes = await axios.post(
    `${GRAPH_API_URL}/${igAccountId}/media`,
    null,
    { params: carouselParams }
  );
  const carouselContainerId = carouselRes.data.id;

  // 4. Esperar que el contenedor principal esté listo
  await esperarProcesamientoMeta(carouselContainerId, accessToken);

  // 5. Publicar el Carrusel
  const publishRes = await axios.post(
    `${GRAPH_API_URL}/${igAccountId}/media_publish`,
    null,
    { params: { creation_id: carouselContainerId, access_token: accessToken } }
  );

  return { postId: publishRes.data.id };
}

module.exports = {
  publicarEnInstagram,
  publicarStoryInstagram,
  publicarCarruselInstagram,
};