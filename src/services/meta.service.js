const axios = require('axios');
const logger = require('../config/logger');
const { META_GRAPH_BASE_URL } = require('../constants');

/**
 * Consulta el estado de procesamiento del contenedor en Meta Graph API
 */
async function esperarContenedorListo(containerId, accessToken, maxAttempts = 20, intervalMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(`${META_GRAPH_BASE_URL}/${containerId}`, {
        params: {
          fields: 'status_code,status',
          access_token: accessToken,
        },
      });

      const { status_code, status } = response.data;
      logger.info('Estado del contenedor en Meta', {
        containerId,
        attempt,
        status_code,
        status,
      });

      if (status_code === 'FINISHED') {
        return true;
      }

      if (status_code === 'ERROR' || status_code === 'EXPIRED') {
        throw new Error(`El contenedor falló en Meta con estado: ${status_code} (${status || 'Sin detalle'})`);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } catch (err) {
      if (err.message.includes('El contenedor falló')) {
        throw err;
      }
      logger.warn(`Error sondeando estado del contenedor [${containerId}] intento ${attempt}`, {
        error: err.response?.data || err.message,
      });
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`Tiempo de espera agotado esperando que Meta procese el archivo.`);
}

/**
 * Detecta si la URL o ruta pertenece a una imagen basándose en la extensión
 */
function esImagen(url) {
  if (!url) return false;
  const urlLimpia = url.split('?')[0].toLowerCase();
  const extensionesVideo = ['.mp4', '.mov', '.avi', '.m4v', '.mkv'];
  
  if (extensionesVideo.some((ext) => urlLimpia.endsWith(ext))) {
    return false;
  }

  return true;
}

/**
 * Publica una foto o Reel en una cuenta de Instagram Business de forma dinámica
 */
async function publicarEnInstagram(instagramAccountId, accessToken, mediaUrl, caption) {
  let containerId = null;
  let attempts = 0;
  const maxAttempts = 3;
  const esFoto = esImagen(mediaUrl);

  // 1. Crear el contenedor
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

  // 2. Esperar que el contenedor esté listo
  if (!esFoto) {
    await esperarContenedorListo(containerId, accessToken);
  } else {
    // Breve pausa para asegurar la disponibilidad del contenedor de la imagen en los CDN de Meta
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // 3. Publicar el contenedor con reintentos si Meta aún reporta "Media ID is not available"
  let postId = null;
  let publishAttempts = 0;

  while (!postId && publishAttempts < 3) {
    publishAttempts++;
    try {
      const publishRes = await axios.post(`${META_GRAPH_BASE_URL}/${instagramAccountId}/media_publish`, {
        creation_id: containerId,
        access_token: accessToken,
      });
      postId = publishRes.data.id;
    } catch (pubError) {
      const subcode = pubError.response?.data?.error?.error_subcode;
      if (subcode === 2207027 && publishAttempts < 3) {
        logger.warn(`El contenido aún no está listo (2207027). Reintentando publicación en 3s (Intento ${publishAttempts})...`);
        await new Promise((res) => setTimeout(res, 3000));
      } else {
        throw pubError;
      }
    }
  }

  return { postId, containerId };
}

module.exports = {
  publicarEnInstagram,
  esperarContenedorListo,
};