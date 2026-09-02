const supabase = require('../config/supabase');

async function enviarBorradorAPermiso(bot, chatId, clienteId, mediaUrl, propuesta) {
  const captionCompleto = `${propuesta.caption}\n\n${propuesta.hashtags.join(' ')}`;

  // 1. Crear el registro preliminar en Supabase
  const { data: publicacion, error } = await supabase
    .from('publicaciones')
    .insert([
      {
        cliente_id: clienteId,
        caption: captionCompleto,
        media_url: mediaUrl,
        plataformas: ['instagram', 'tiktok'],
        estado: 'borrador'
      }
    ])
    .select()
    .single();

  if (error) {
    console.error('Error al guardar borrador:', error);
    return;
  }

  // 2. Formatear mensaje para Telegram
  const mensajeTelegram = `
✨ *NUEVA PROPUESTA DE CONTENIDO* ✨

🎬 *Idea del Video:* ${propuesta.sugerencia_visual}

📝 *Caption Sugerido:*
${captionCompleto}
  `;

  // 3. Enviar mensaje con botones Inline
  await bot.sendMessage(chatId, mensajeTelegram, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Aprobar', callback_data: `aprobar_${publicacion.id}` },
          { text: '❌ Rechazar', callback_data: `rechazar_${publicacion.id}` }
        ]
      ]
    }
  });
}

module.exports = { enviarBorradorAPermiso };