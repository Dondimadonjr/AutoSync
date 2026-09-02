const { Router } = require('express');
const { handleWebhook } = require('../controllers/telegram.controller');
const { validateTelegramSecret } = require('../middlewares/auth.middleware');

const router = Router();

// Endpoint que recibe notificaciones de Telegram mediante Webhook
router.post('/telegram-webhook', validateTelegramSecret, handleWebhook);

module.exports = router;
