async function enviarBorradorAPermiso(bot, chatId, clienteId, mediaUrl, propuesta) {
  // Asegurar que use el Chat ID del .env si no se especifica
  const targetChatId = chatId || process.env.TELEGRAM_CHAT_ID;

  const captionText = `📌 *Nueva propuesta de publicación*\n\n` +
    `*Caption:* ${propuesta.caption}\n\n` +
    `*Hashtags:* ${Array.isArray(propuesta.hashtags) ? propuesta.hashtags.join(' ') : propuesta.hashtags}\n\n` +
    `*Sugerencia:* ${propuesta.sugerencia_visual}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Aprobar', callback_data: `aprobar_${clienteId}` },
        { text: '❌ Rechazar', callback_data: `rechazar_${clienteId}` }
      ]
    ]
  };

  // Enviar mensaje directo con los botones interactivos
  return await bot.sendMessage(targetChatId, captionText, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

module.exports = { enviarBorradorAPermiso };