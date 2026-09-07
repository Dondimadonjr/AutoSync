const axios = require('axios');
const logger = require('../config/logger');

const GRAPH_API_URL = 'https://graph.facebook.com/v19.0';

/**
 * Espera activamente a que Meta termine de procesar un contenedor multimedia (status_code === 'FINISHED')
 */
async function esperarProcesamientoMeta(containerId, accessToken, maxIntentos = 12) {
  const checkUrl = `${GRAPH_API_URL}/${containerId}`;
  
  for (let i = 0; i < maxIntentos; i++) {
    const res = await axios.get(checkUrl, {
      params: { 
        fields: 'status_code,status', 
        access_token: accessToken 
      }
    });

    const statusCode = res.data?.status_code;
    logger.info(`Estado del contenedor Meta (${containerId}): ${statusCode} (Intento ${i + 1}/${maxIntentos})`);

    if (statusCode === 'FINISHED') {
      return true;
    }

    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new Error(`El procesamiento del archivo multimedia falló en Meta: ${res.data?.status || statusCode}`);
    }

    // Esperar 3.5 segundos antes de reintentar
    await new Promise((resolve) => setTimeout(resolve, 3500));
  }

  throw new Error('Tiempo de espera agotado: Meta tardó demasiado en procesar el archivo multimedia.');
}

/**
 * Publica una foto o video (Reel) en el Feed de Instagram
 */
async function publicarEnInstagram(igAccountId, accessToken, mediaUrl, caption) {
  const isVideo = typeof mediaUrl === 'string' && mediaUrl.toLowerCase().includes('.mp4');
  const containerUrl = `${GRAPH_API_URL}/${igAccountId}/media`;
  
  const containerParams = {
    access_token: accessToken,
    caption: caption,
    [isVideo ? 'video_url' : 'image_url']: mediaUrl,
    ...(isVideo && { media_type: 'REELS' }),
  };

  logger.info(`Creando contenedor en Meta (${isVideo ? 'REEL' : 'IMAGE'})...`, { igAccountId });
  const containerRes = await axios.post(containerUrl, null, { params: containerParams });
  const creationId = containerRes.data.id;

  // Esperar a que el contenedor esté procesado
  await esperarProcesamientoMeta(creationId, accessToken);

  const publishUrl = `${GRAPH_API_URL}/${igAccountId}/media_publish`;
  const publishRes = await axios.post(publishUrl, null, {
    params: { creation_id: creationId, access_token: accessToken },
  });

  return { postId: publishRes.data.id };
}

/**
 * Publica explícitamente un Instagram Reel
 */
async function publicarReelInstagram(igAccountId, accessToken, videoUrl, caption) {
  return publicarEnInstagram(igAccountId, accessToken, videoUrl, caption);
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

  logger.info('Creando contenedor de Story en Meta...', { igAccountId });
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
    const isVideo = typeof media === 'object' 
      ? Boolean(media.isVideo) 
      : String(media).toLowerCase().includes('.mp4');
      
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

/**
 * Publica una foto, video o texto en una Página de Facebook
 */
async function publicarEnFacebook(pageId, pageAccessToken, mediaUrl, caption) {
  try {
    const isVideo = typeof mediaUrl === 'string' && mediaUrl.toLowerCase().includes('.mp4');
    
    if (isVideo) {
      // Publicar video en Facebook Page
      const res = await axios.post(`${GRAPH_API_URL}/${pageId}/videos`, null, {
        params: {
          file_url: mediaUrl,
          description: caption,
          access_token: pageAccessToken,
        },
      });
      logger.info('Video publicado exitosamente en Facebook Page:', res.data);
      return { postId: res.data.id };
    }

    if (mediaUrl) {
      // Publicar foto única en Facebook Page
      const res = await axios.post(`${GRAPH_API_URL}/${pageId}/photos`, null, {
        params: {
          url: mediaUrl,
          message: caption,
          access_token: pageAccessToken,
        },
      });
      logger.info('Foto publicada exitosamente en Facebook Page:', res.data);
      return { postId: res.data.id };
    }

    // Publicar solo texto
    const res = await axios.post(`${GRAPH_API_URL}/${pageId}/feed`, null, {
      params: {
        message: caption,
        access_token: pageAccessToken,
      },
    });
    logger.info('Post de texto publicado exitosamente en Facebook Page:', res.data);
    return { postId: res.data.id };

  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    logger.error('Error al publicar en Facebook Page:', { error: errorMsg });
    throw new Error(`Facebook API Error: ${errorMsg}`);
  }
}

/**
 * Publica una Historia (Story) en una Página de Facebook
 */
async function publicarStoryFacebook(pageId, pageAccessToken, mediaUrl, isVideo = false) {
  try {
    if (isVideo) {
      // Publicar video story en Facebook Page
      const res = await axios.post(`${GRAPH_API_URL}/${pageId}/video_stories`, null, {
        params: {
          file_url: mediaUrl,
          access_token: pageAccessToken,
        },
      });
      logger.info('Video Story publicada exitosamente en Facebook Page:', res.data);
      return { postId: res.data.id };
    }

    // Publicar photo story en Facebook Page
    const res = await axios.post(`${GRAPH_API_URL}/${pageId}/photo_stories`, null, {
      params: {
        url: mediaUrl,
        access_token: pageAccessToken,
      },
    });
    logger.info('Foto Story publicada exitosamente en Facebook Page:', res.data);
    return { postId: res.data.id };

  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    logger.error('Error al publicar Story en Facebook Page:', { error: errorMsg });
    throw new Error(`Facebook Story Error: ${errorMsg}`);
  }
}

module.exports = {
  publicarEnInstagram,
  publicarReelInstagram,
  publicarStoryInstagram,
  publicarCarruselInstagram,
  publicarEnFacebook,
  publicarStoryFacebook,
};