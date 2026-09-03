const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const env = require('../config/env');
const logger = require('../config/logger');

// Usar obligatoriamente la Service Role Key para ignorar RLS en subidas
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
const supabase = createClient(env.SUPABASE_URL, supabaseKey);

/**
 * Descarga un archivo multimedia de Telegram y lo sube a Supabase Storage.
 * @param {string} fileId ID del archivo en Telegram
 * @param {string} botToken Token del bot de Telegram
 * @returns {Promise<string>} URL pública del archivo alojado en Supabase Storage
 */
async function subirVideoDesdeTelegram(fileId, botToken) {
  try {
    // 1. Obtener la ruta del archivo en los servidores de Telegram
    const fileRes = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const filePath = fileRes.data.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

    // 2. Descargar el archivo como Buffer
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');

    // 3. Definir un nombre único para Supabase Storage
    const fileName = `telegram_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;

    // 4. Subir al bucket 'media'
    const { data, error } = await supabase.storage
      .from('media')
      .upload(fileName, buffer, {
        contentType: 'video/mp4',
        upsert: true,
      });

    if (error) {
      throw error;
    }

    // 5. Obtener la URL pública del archivo
    const { data: publicUrlData } = supabase.storage
      .from('media')
      .getPublicUrl(fileName);

    logger.info('Video de Telegram subido exitosamente a Supabase Storage', {
      fileName,
      publicUrl: publicUrlData.publicUrl,
    });

    return publicUrlData.publicUrl;
  } catch (error) {
    logger.error('Error al subir video desde Telegram a Supabase Storage:', {
      mensaje: error.message,
      detalles: error.response?.data || error,
    });
    throw error;
  }
}

module.exports = {
  subirVideoDesdeTelegram,
};