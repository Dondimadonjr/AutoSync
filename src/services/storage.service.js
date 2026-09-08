const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const env = require('../config/env');
const logger = require('../config/logger');

// Usar obligatoriamente la Service Role Key para ignorar RLS en subidas
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
const supabase = createClient(env.SUPABASE_URL, supabaseKey);

/**
 * Descarga un archivo multimedia de Telegram (Foto o Video) y lo sube a Supabase Storage.
 * @param {string} fileId ID del archivo en Telegram
 * @returns {Promise<string>} URL pública del archivo alojado en Supabase Storage
 */
async function subirVideoDesdeTelegram(fileId) {
  try {
    const botToken = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN no está definido en las variables de entorno.');
    }

    // 1. Obtener la ruta del archivo en los servidores de Telegram
    const fileRes = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);

    if (!fileRes.data.ok) {
      throw new Error(`Telegram API Error: ${fileRes.data.description}`);
    }

    const filePath = fileRes.data.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

    // 2. Detectar extensión y contentType dinámicamente
    let ext = 'jpg';
    if (filePath.includes('.')) {
      ext = filePath.split('.').pop().toLowerCase();
    }

    const esVideo = ['mp4', 'mov', 'avi', 'mkv'].includes(ext);
    const contentType = esVideo ? `video/${ext === 'mov' ? 'quicktime' : 'mp4'}` : `image/${ext === 'png' ? 'png' : 'jpeg'}`;

    // 3. Nombre único manteniendo la extensión real
    const fileName = `telegram_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;

    // 4. Descargar el archivo como Buffer
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');

    // 5. Subir al bucket 'media' con el contentType correcto
    const { error } = await supabase.storage
      .from('media')
      .upload(fileName, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      throw error;
    }

    // 6. Obtener la URL pública del archivo
    const { data: publicUrlData } = supabase.storage
      .from('media')
      .getPublicUrl(fileName);

    logger.info('Archivo de Telegram subido exitosamente a Supabase Storage', {
      fileName,
      contentType,
      publicUrl: publicUrlData.publicUrl,
    });

    return publicUrlData.publicUrl;
  } catch (error) {
    logger.error('Error al subir multimedia desde Telegram a Supabase Storage:', {
      mensaje: error.message,
      detalles: error.response?.data || error,
    });
    throw error;
  }
}

/**
 * Descarga un archivo de Telegram y retorna su buffer + metadata (sin subir a Storage).
 * Útil para pasar la imagen a Gemini antes de almacenarla.
 * @param {string} fileId ID del archivo en Telegram
 * @returns {Promise<{ buffer: Buffer, contentType: string, ext: string, fileUrl: string }>}
 */
async function descargarArchivoTelegram(fileId) {
  const botToken = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN no está definido en las variables de entorno.');
  }

  const fileRes = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);

  if (!fileRes.data.ok) {
    throw new Error(`Telegram API Error: ${fileRes.data.description}`);
  }

  const filePath = fileRes.data.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

  let ext = 'jpg';
  if (filePath.includes('.')) {
    ext = filePath.split('.').pop().toLowerCase();
  }

  const esVideo = ['mp4', 'mov', 'avi', 'mkv'].includes(ext);
  const contentType = esVideo
    ? `video/${ext === 'mov' ? 'quicktime' : 'mp4'}`
    : `image/${ext === 'png' ? 'png' : 'jpeg'}`;

  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data, 'binary');

  return { buffer, contentType, ext, fileUrl };
}

/**
 * Sube un buffer ya descargado a Supabase Storage y retorna la URL pública.
 * @param {Buffer} buffer  Contenido del archivo
 * @param {string} contentType  MIME type
 * @param {string} ext  Extensión del archivo (sin punto)
 * @returns {Promise<string>} URL pública
 */
async function subirBufferASupabase(buffer, contentType, ext) {
  const fileName = `telegram_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;

  const { error } = await supabase.storage
    .from('media')
    .upload(fileName, buffer, { contentType, upsert: true });

  if (error) throw error;

  const { data: publicUrlData } = supabase.storage.from('media').getPublicUrl(fileName);

  logger.info('Buffer subido exitosamente a Supabase Storage', { fileName, contentType, publicUrl: publicUrlData.publicUrl });

  return publicUrlData.publicUrl;
}

module.exports = {
  subirVideoDesdeTelegram,
  descargarArchivoTelegram,
  subirBufferASupabase,
};