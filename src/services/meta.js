const axios = require('axios'); // Asegúrate de instalarlo con: npm install axios

/**
 * Publica un Reels/Video en Instagram
 * @param {string} instagramAccountId ID de la cuenta empresarial de Instagram
 * @param {string} accessToken Token de acceso de la página
 * @param {string} videoUrl URL pública del video en Supabase Storage
 * @param {string} caption Texto de la publicación
 */
async function publicarEnInstagram(instagramAccountId, accessToken, videoUrl, caption) {
  try {
    // 1. Crear contenedor de Reel/Video
    const containerRes = await axios.post(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media`,
      {
        media_type: 'REELS',
        video_url: videoUrl,
        caption: caption,
        access_token: accessToken
      }
    );

    const creationId = containerRes.data.id;
    console.log(`Contenedor creado en IG: ${creationId}`);

    // Esperar unos segundos a que Meta procese el video
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 2. Publicar el contenedor
    const publishRes = await axios.post(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media_publish`,
      {
        creation_id: creationId,
        access_token: accessToken
      }
    );

    return publishRes.data; // Devuelve el ID final de la publicación
  } catch (error) {
    console.error('Error al publicar en Instagram:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = { publicarEnInstagram };