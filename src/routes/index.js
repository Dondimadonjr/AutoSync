const { Router } = require('express');
const postRoutes = require('./post.routes');
const telegramRoutes = require('./telegram.routes');
const cronHandler = require('../../api/cron');

const router = Router();

// Health check endpoint
router.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'AutoSync 🚀',
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

router.get('/api/cron/publish-scheduled', cronHandler);

// Registrar módulos de rutas
router.use('/api', postRoutes);
router.use('/api', telegramRoutes);

module.exports = router;
