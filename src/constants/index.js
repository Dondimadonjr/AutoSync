/**
 * Constantes de la aplicación SocialSync
 */
const POST_STATUS = Object.freeze({
  BORRADOR: 'borrador',
  APROBADO: 'aprobado',
  PROCESANDO: 'procesando',
  PUBLICADO: 'publicado',
  FALLIDO: 'fallido',
  RECHAZADO: 'rechazado',
});

const PLATFORMS = Object.freeze({
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
  FACEBOOK: 'facebook',
});

const META_GRAPH_VERSION = 'v19.0';
const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

module.exports = {
  POST_STATUS,
  PLATFORMS,
  META_GRAPH_VERSION,
  META_GRAPH_BASE_URL,
};
