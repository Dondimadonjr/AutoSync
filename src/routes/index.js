const { Router } = require('express');
const postRoutes = require('./post.routes');
const telegramRoutes = require('./telegram.routes');

const router = Router();

// Health check endpoint
router.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'SocialSync AI Engine 🚀',
    timestamp: new Date().toISOString(),
    version: '2.0.0-enterprise',
  });
});

router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// Registrar módulos de rutas
router.use('/', postRoutes);
router.use('/', telegramRoutes);

module.exports = router;
