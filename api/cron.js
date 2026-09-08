const supabase = require('../src/config/supabase');
const logger = require('../src/config/logger');
const { POST_STATUS } = require('../src/constants');
const { procesarAprobacionAsync } = require('../src/services/publisher.service');

module.exports = async function handler(req, res) {
  try {
    const ahora = new Date().toISOString();
    logger.info(`[CRON] Verificando publicaciones programadas a las: ${ahora}`);

    // 1. Obtener publicaciones programadas cuya fecha/hora sea menor o igual a la actual
    const { data: pendientes, error } = await supabase
      .from('publicaciones')
      .select('*, clientes(*)')
      .eq('estado', POST_STATUS.PROGRAMADO || 'PROGRAMADO')
      .lte('programado_para', ahora);

    if (error) {
      logger.error('Error al consultar Supabase en Cron:', error);
      return res.status(200).json({ ok: false, error: error.message });
    }

    if (!pendientes || pendientes.length === 0) {
      logger.info('[CRON] No hay publicaciones pendientes por publicar.');
      return res.status(200).json({ ok: true, procesadas: 0 });
    }

    logger.info(`[CRON] Procesando ${pendientes.length} publicación(es) programada(s)...`);

    // 2. Procesar cada publicación pendiente invocando el servicio central
    for (const pub of pendientes) {
      const chatId = pub.clientes?.telegram_chat_id || process.env.TELEGRAM_ADMIN_CHAT_ID;
      
      try {
        // Ejecuta el flujo completo (Instagram + Facebook Page + Telegram Chat)
        await procesarAprobacionAsync(pub.id, chatId);
      } catch (pubErr) {
        logger.error(`Error en Cron procesando post ${pub.id}:`, { error: pubErr.message });
      }
    }

    return res.status(200).json({ ok: true, procesadas: pendientes.length });
  } catch (error) {
    logger.error('Error general en ejecución de Cron:', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
};