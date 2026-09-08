const supabase = require('../config/supabase');
const { sendMessage } = require('../services/telegram.service');
const logger = require('../config/logger');

/**
 * Lista las publicaciones agendadas pendientes y las envía al chat de Telegram
 */
async function listarAgendados(chatId) {
  try {
    const { data: publicaciones, error } = await supabase
      .from('publicaciones')
      .select('id, caption, programado_para, tipo_publicacion, plataformas, media_url')
      .eq('estado', 'PROGRAMADO')
      .order('programado_para', { ascending: true });

    if (error) throw error;

    if (!publicaciones || publicaciones.length === 0) {
      await sendMessage(chatId, '📅 *No tienes publicaciones agendadas pendientes.*');
      return;
    }

    await sendMessage(chatId, `📋 *Tienes ${publicaciones.length} publicación(es) agendada(s):*`);

    for (const post of publicaciones) {
      const fecha = new Date(post.programado_para).toLocaleString('es-ES', {
        timeZone: 'America/Santiago', // Ajusta según tu zona horaria
        dateStyle: 'medium',
        timeStyle: 'short',
      });

      const plataformasText = Array.isArray(post.plataformas) 
        ? post.plataformas.join(', ') 
        : 'instagram, facebook';

      const previewCaption = post.caption 
        ? (post.caption.length > 80 ? post.caption.substring(0, 80) + '...' : post.caption)
        : '_Sin descripción_';

      const mensaje = 
        `📌 *ID:* \`${post.id}\`
📅 *Fecha:* ${fecha}
🌐 *Plataformas:* ${plataformasText}
📱 *Formato:* ${post.tipo_publicacion || 'FEED'}
📝 *Caption:* ${previewCaption}`;

      const replyMarkup = {
        inline_keyboard: [
          [
            { text: '🚀 Publicar Ahora', callback_data: `force_publish_${post.id}` },
            { text: '❌ Cancelar', callback_data: `cancel_schedule_${post.id}` }
          ]
        ]
      };

      await sendMessage(chatId, mensaje, replyMarkup);
    }

  } catch (error) {
    logger.error('Error al listar agendados:', { error: error.message });
    await sendMessage(chatId, '❌ Hubo un error al obtener las publicaciones agendadas.');
  }
}

module.exports = { listarAgendados };