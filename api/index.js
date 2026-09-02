const express = require('express');
const supabase = require('../src/config/supabase');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

const token = process.env.TELEGRAM_BOT_TOKEN;

// Validar que el token esté disponible
if (!token) {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN no está configurado en las variables de entorno');
}

// En producción (Vercel) usamos Webhooks; en desarrollo local deshabilitamos polling
// para evitar el error 409 al reiniciar con Nodemon
let bot;
if (token) {
  bot = new TelegramBot(token, { polling: true });
  console.log('✅ Bot de Telegram inicializado correctamente');
}

const { generarPropuestaPublicacion } = require('../src/services/ai');
const { enviarBorradorAPermiso } = require('../src/services/notifier');
const { publicarEnInstagram } = require('../src/services/meta');

// Endpoint para solicitar la creación de un nuevo post
app.post('/api/generar-post', async (req, res) => {
  try {
    const { clienteId, producto, descripcion, mediaUrl } = req.body;

    // Generar con IA
    const propuesta = await generarPropuestaPublicacion(producto, descripcion);

    // Notificar por Telegram
    const chatId = process.env.TELEGRAM_CHAT_ID;
    await enviarBorradorAPermiso(bot, chatId, clienteId, mediaUrl, propuesta);

    res.status(200).send({ status: 'Borrador generado y enviado a Telegram para aprobación' });
  } catch (error) {
    console.error('Error detallado:', error);
    res.status(500).send({ error: 'Error en la generación de borrador', detalle: error.message });
  }
});

// Ruta para verificar estado del servidor
app.get('/', (req, res) => {
  res.send({ status: 'SocialSync AI Engine Activo 🚀' });
});

// Endpoint que recibirá las notificaciones de Telegram mediante Webhook cuando despleguemos en Vercel
app.post(`/api/telegram-webhook`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Manejador de eventos de Telegram (Bot Interactivo)
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `¡Hola! Bienvenido a *SocialSync AI* 🤖.\n\nDesde aquí podrás aprobar o rechazar el contenido generado para tus redes sociales.\nTu Chat ID es: \`${chatId}\``,
    { parse_mode: 'Markdown' }
  );
});

// Listener para los botones de aprobación/rechazo con publicación en Instagram
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const [accion, publicacionId] = query.data.split('_');

  if (accion === 'aprobar') {
    // 1. Obtener la publicación desde Supabase con los datos del cliente
    const { data: pub, error } = await supabase
      .from('publicaciones')
      .select('*, clientes(*)')
      .eq('id', publicacionId)
      .single();

    if (error || !pub) {
      bot.sendMessage(chatId, '❌ No se encontró la publicación.');
      bot.answerCallbackQuery(query.id);
      return;
    }

    // 2. Obtener las credenciales de Instagram del cliente
    const { data: creds } = await supabase
      .from('credenciales_redes')
      .select('*')
      .eq('cliente_id', pub.cliente_id)
      .eq('plataforma', 'instagram')
      .single();

    if (!creds) {
      bot.sendMessage(chatId, '⚠️ Publicación aprobada, pero el cliente no tiene tokens de Instagram vinculados.');
      await supabase.from('publicaciones').update({ estado: 'aprobado' }).eq('id', publicacionId);
      bot.answerCallbackQuery(query.id);
      return;
    }

    bot.sendMessage(chatId, '⏳ Publicando contenido en Instagram...');

    try {
      // 3. Ejecutar la publicación en Instagram
      const resultado = await publicarEnInstagram(
        creds.cuenta_id,
        creds.token_acceso,
        pub.media_url,
        pub.caption
      );

      // 4. Actualizar el estado en la base de datos
      await supabase
        .from('publicaciones')
        .update({ estado: 'publicado', instagram_post_id: resultado.id })
        .eq('id', publicacionId);

      bot.sendMessage(chatId, `🎉 ¡Publicado con éxito en Instagram! ID Post: \`${resultado.id}\``, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Error al publicar en Instagram:', err);
      bot.sendMessage(chatId, '❌ Error al publicar en la API de Instagram. Revisa las credenciales o el video.');
      // Mantener el estado como aprobado aunque falle la publicación
      await supabase.from('publicaciones').update({ estado: 'aprobado' }).eq('id', publicacionId);
    }
  } else if (accion === 'rechazar') {
    await supabase
      .from('publicaciones')
      .update({ estado: 'rechazado' })
      .eq('id', publicacionId);

    bot.sendMessage(chatId, `❌ Publicación \`${publicacionId}\` rechazada.`, { parse_mode: 'Markdown' });
  }

  bot.answerCallbackQuery(query.id);
});

// Escuchar puerto solo en entorno local (no en Vercel)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo localmente en el puerto ${PORT}`);
  });
}

// Exportar la app para Vercel
module.exports = app;