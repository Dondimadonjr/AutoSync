const axios = require('axios');

/**
 * Publica una Historia (Story) en Instagram
 */
async function publicarStoryInstagram(igAccountId, accessToken, mediaUrl, isVideo = false) {
  const mediaType = isVideo ? 'VIDEO' : 'IMAGE';
  
  // 1. Crear contenedor de Story
  const containerUrl = `https://graph.facebook.com/v19.0/${igAccountId}/media`;
  const containerParams = {
    access_token: accessToken,
    media_type: 'STORIES',
    [isVideo ? 'video_url' : 'image_url']: mediaUrl,
  };

  const containerRes = await axios.post(containerUrl, null, { params: containerParams });
  const creationId = containerRes.data.id;

  // Si es video, esperar brevemente a que Meta termine de procesarlo
  if (isVideo) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // 2. Publicar la Historia
  const publishUrl = `https://graph.facebook.com/v19.0/${igAccountId}/media_publish`;
  const publishRes = await axios.post(publishUrl, null, {
    params: { creation_id: creationId, access_token: accessToken },
  });

  return { postId: publishRes.data.id };
}

/**
 * Publica un Carrusel (múltiples fotos/videos) en Instagram
 */
async function publicarCarruselInstagram(igAccountId, accessToken, mediaUrls, caption) {
  // 1. Crear contenedores individuales para cada elemento del carrusel
  const itemContainerIds = [];

  for (const media of mediaUrls) {
    const isVideo = typeof media === 'object' ? media.isVideo : media.endsWith('.mp4');
    const url = typeof media === 'object' ? media.url : media;

    const containerParams = {
      access_token: accessToken,
      is_carousel_item: true,
      [isVideo ? 'video_url' : 'image_url']: url,
    };

    const itemRes = await axios.post(
      `https://graph.facebook.com/v19.0/${igAccountId}/media`,
      null,
      { params: containerParams }
    );
    itemContainerIds.push(itemRes.data.id);
  }

  // 2. Crear el contenedor principal del Carrusel
  const carouselParams = {
    access_token: accessToken,
    media_type: 'CAROUSEL',
    children: itemContainerIds.join(','),
    caption: caption,
  };

  const carouselRes = await axios.post(
    `https://graph.facebook.com/v19.0/${igAccountId}/media`,
    null,
    { params: carouselParams }
  );
  const carouselContainerId = carouselRes.data.id;

  // 3. Publicar el Carrusel
  const publishRes = await axios.post(
    `https://graph.facebook.com/v19.0/${igAccountId}/media_publish`,
    null,
    { params: { creation_id: carouselContainerId, access_token: accessToken } }
  );

  return { postId: publishRes.data.id };
}

module.exports = {
  // ... tus funciones existentes
  publicarStoryInstagram,
  publicarCarruselInstagram,
};