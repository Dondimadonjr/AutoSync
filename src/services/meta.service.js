const axios = require('axios');
const logger = require('../config/logger');
const { META_GRAPH_BASE_URL } = require('../constants');

/**
 * Consulta el estado de procesamiento del contenedor en Meta Graph API
 */
async function esperarContenedorListo(containerId, accessToken, maxAttempts = 30, intervalMs = 3000) {
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
 * Detecta si la URL o ruta pertenece a una imagen basándose en la extensión
 */
function esImagen(url) {
  const extensionesImagen = ['.jpg', '.jpeg', '.png', '.webp'];
  const urlLimpia = url.split('?')[0].toLowerCase();
  return extensionesImagen.some((ext) => urlLimpia.endsWith(ext));
}

/**
 * Publica una foto o Reel en una cuenta de Instagram Business de forma dinámica
 */
async function publicarEnInstagram(instagramAccountId, accessToken, mediaUrl, caption) {
  let containerId = null;
  let attempts = 0;
  const maxAttempts = 3;
  const esFoto = esImagen(mediaUrl);

  while (!containerId && attempts < maxAttempts) {
    attempts++;
    try {
      logger.info(`Intento ${attempts} de creación de contenedor en Meta (${esFoto ? 'IMAGE' : 'REELS'})...`);

      const payload = esFoto
        ? {
            image_url: mediaUrl,
            caption,
            access_token: accessToken,
          }
        : {
            media_type: 'REELS',
            video_url: mediaUrl,
            caption,
            access_token: accessToken,
          };

      const containerRes = await axios.post(`${META_GRAPH_BASE_URL}/${instagramAccountId}/media`, payload);
      containerId = containerRes.data.id;
    } catch (error) {
      if (attempts >= maxAttempts) throw error;
      logger.warn(`Fallo al crear contenedor (Intento ${attempts}). Reintentando en 3s...`, {
        error: error.response?.data || error.message,
      });
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  logger.info('Contenedor creado exitosamente en Meta', { containerId, esFoto });

  // Solo los videos/Reels requieren sondeo de transcodificación
  if (!esFoto) {
    await esperarContenedorListo(containerId, accessToken);
  }

  // Publicar el contenedor en Instagram
  const publishRes = await axios.post(`${META_GRAPH_BASE_URL}/${instagramAccountId}/media_publish`, {
    creation_id: containerId,
    access_token: accessToken,
  });

  return { postId: publishRes.data.id, containerId };
}

module.exports = {
  publicarEnInstagram,
  esperarContenedorListo,
};